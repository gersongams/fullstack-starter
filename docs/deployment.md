# Deployment

How the system is packaged, how to run the production images locally, and what a release does. Nothing is deployed yet and no hosting target is wired in; the hosting plan and the per-host checklist are in [Development and operations](development.md#deployment-notes).

## Images

| Image | Dockerfile | Build context | Notes |
| --- | --- | --- | --- |
| API | `apps/api/Dockerfile` | `apps/api` | Static binary on distroless, about 25 MB, runs as non-root, `APP_ENV=production` by default. The same image runs migrations: its entrypoint is the binary, so the command `migrate` applies them and exits |
| Web | `apps/web/Dockerfile` | repository root | Next.js standalone output on `node:24-slim`, runs as the `node` user on port 3100 |

The web image takes `API_INTERNAL_URL` as a **build argument**, because Next.js evaluates the `/api/v1` rewrite at build time. One web image therefore targets one API address. See [Container images](development.md#container-images) for the consequences.

## Production-like stack with compose

`compose.prod.yaml` is an overlay on `compose.yaml` that builds both Dockerfiles and runs them against the compose Postgres with `APP_ENV=production`. Use it to exercise the images before a release.

```sh
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
docker compose -f compose.yaml -f compose.prod.yaml up --build
# web: http://localhost:3100    API health: http://localhost:8787/healthz
docker compose -f compose.yaml -f compose.prod.yaml down
```

Stop `make dev` first: the stack publishes the same host ports. Both are bound to `127.0.0.1` only.

Services, in start order:

| Service | What it does |
| --- | --- |
| `postgres` | From `compose.yaml`. The same database and volume as local development |
| `migrate` | One-shot. Runs the API image with the command `migrate` (goose). Creates the `auth` schema |
| `auth-migrate` | One-shot, after `migrate`. Runs `pnpm --filter web db:migrate` to create Better Auth's tables |
| `api` | Starts after `migrate` succeeds |
| `web` | Starts after `auth-migrate` succeeds. Has a healthcheck on `/sign-in` |

Things worth knowing:

- **It is an overlay, not a profile.** Compose interpolates every service even when its profile is inactive, so a required `BETTER_AUTH_SECRET` inside `compose.yaml` would make plain `docker compose up` (and `make db-up`) fail for everyone who has not set it.
- **`BETTER_AUTH_SECRET` is never in the file.** Compose refuses to start without it. Signing keys in the `jwks` table are encrypted with it, so use the same value for the lifetime of a database volume; with a new secret, delete the volume (`docker compose down -v`) or the rows in `auth.jwks`.
- **Issuer and JWKS address differ, on purpose.** `AUTH_ISSUER` is compared as a string with the token's `iss` claim, so it is the web app's public origin (`BETTER_AUTH_URL`, default `http://localhost:3100`). `AUTH_JWKS_URL` only has to be reachable from the API container, so it is `http://web:3100/api/auth/jwks`.
- **The runtime web image cannot run Better Auth's migration.** It is a standalone bundle without the Better Auth CLI (a devDependency) and without `src/lib/auth.ts`. `auth-migrate` therefore builds the web Dockerfile's `build` stage, which has the sources and devDependencies, and runs the CLI there. That stage is about 1.5 GB and is not published by the release workflow; see the release order below for what to do in a real deployment.
- The API image has no shell, so it has no container healthcheck. Probe `/healthz` and `/readyz` from outside.

This was verified on a clean checkout: both images build, both migrations apply, and a sign-up followed by `GET /api/v1/me` through the web app's rewrite returns 200 with JSON logs from the API and the docs endpoints disabled.

## Environment variables in production

API:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production` (the image default). JSON logs, docs endpoints off. Any value other than `development` or `production` fails startup |
| `DATABASE_URL` | Postgres connection string. Secret |
| `AUTH_ISSUER` | The web app's public `https://` origin. Must equal the web app's `BETTER_AUTH_URL` |
| `AUTH_JWKS_URL` | `<address of the web app reachable from the API>/api/auth/jwks` |
| `AUTH_AUDIENCE` | Must equal the web app's `API_JWT_AUDIENCE` (`starter-api`) |
| `TRUSTED_PROXIES` | CIDRs of the load balancer and the web app, **only** when a load balancer or CDN in front of the web app appends the client address to `X-Forwarded-For`. Next.js forwards the browser's header unchanged, so without such a load balancer leave it empty. See [Backend](backend.md#rate-limiting) |
| `MIGRATE_ON_START` | Optional, default `false` in production. `true` applies pending API migrations before the server listens, under an advisory lock, and replaces release step 1. See [Database](database.md#when-migrations-run) |
| `RATE_LIMIT_PER_MINUTE` | Optional, default `300` per client address and per user |
| `RATE_LIMIT_STORE` | `postgres` when more than one API instance runs, so they share one limit. Default `memory` counts per instance |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional. Turns tracing on. See [Backend](backend.md#observability) |
| `PORT`, `LOG_LEVEL` | Optional: `8787`, `info` |

Web:

| Variable | When | Value |
| --- | --- | --- |
| `API_INTERNAL_URL` | **Build** | Origin of the Go API as seen from the web app |
| `DATABASE_URL` | Runtime | Postgres connection string. Secret |
| `BETTER_AUTH_SECRET` | Runtime | Secret. Rotating it signs everyone out and invalidates the stored signing keys |
| `BETTER_AUTH_URL` | Runtime | Public `https://` origin of the web app |
| `API_JWT_AUDIENCE` | Runtime | Optional, default `starter-api` |
| `SMTP_URL` | Runtime | Your mail provider's SMTP endpoint, for example `smtps://user:password@smtp.example.com:465`. Secret. Required: without it there is no password reset |
| `MAIL_FROM` | Runtime | Sender, `Name <address>`, on a domain the provider is allowed to send for |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Runtime | `true` in production: no session until the address is confirmed |
| `AUTH_IP_HEADER`, `AUTH_TRUSTED_PROXIES` | Runtime | Where Better Auth's rate limiter reads the client address. With the default (`x-forwarded-for`) a client can forge it and dodge the sign-in limit, so name the header your proxy or CDN sets and overwrites. See [Authentication](authentication.md) |

Keep secrets in the platform's secret store, never in an image or a committed file.

## Release order

Migrations are release steps, not something the servers do on startup, so several instances starting at once cannot race.

1. **API migrations:** run the new API image with the command `migrate` and the production `DATABASE_URL`. It needs no other variable. Skip this step when the API runs with `MIGRATE_ON_START=true`: each new instance then migrates before it listens, taking turns on an advisory lock. Keep the explicit step for long migrations or ones that must be sequenced with the code change.
2. **Better Auth migration**, only when Better Auth was upgraded or a plugin was added: run `pnpm --filter web db:migrate` from a checkout of the released tag (a CI job or a release machine) with the production `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` set. Use a direct connection, not a transaction-mode pooler. It cannot run from the published web image, for the reason given above.
3. **Roll out** the API, then the web app.

Write migrations so the previous version of the code keeps working against the new schema (add first, remove in a later release); otherwise step 3 has a window where old instances fail.

## Release workflow

`.github/workflows/release.yml` runs when a tag matching `v*` is pushed:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

It builds both images and pushes them to GHCR as `ghcr.io/<owner>/<repo>-api` and `ghcr.io/<owner>/<repo>-web`, tagged with the version (`0.1.0`), the minor line (`0.1`) and the commit (`sha-...`). The job has `packages: write` and nothing else beyond reading the repository; it uses the built-in `GITHUB_TOKEN`, so no secret has to be configured.

The web image bakes in `API_INTERNAL_URL`. Set the repository **variable** `API_INTERNAL_URL` (Settings, Secrets and variables, Actions, Variables) to the address the web app uses to reach the API in production. Without it the workflow falls back to `http://api:8787`, which only suits a compose-style network.

The workflow publishes images and stops there. Running the migrations and rolling out are deliberately not automated until a hosting target is chosen.

## Dependency updates and security scans

| What | Where | Behaviour |
| --- | --- | --- |
| Dependabot | `.github/dependabot.yml` | Weekly. Go modules (`apps/api`), the pnpm workspace (root lockfile), GitHub Actions, the base images of both Dockerfiles and the Postgres image in `compose.yaml`. Minor and patch updates are grouped into one pull request per ecosystem; majors come one at a time |
| `govulncheck` | CI, API job | Fails on a known vulnerability in a code path the API actually calls. Vulnerabilities in modules that are required but never called are reported without failing |
| `pnpm audit --prod --audit-level=high` | CI, web job | Fails on a high or critical advisory in a runtime dependency. devDependencies are excluded because they never reach the image |
| Image builds | CI, `docker` job | Builds both Dockerfiles on every pull request without pushing, so a broken Dockerfile is caught before a release tag |

A Dependabot pull request that changes the API contract's tooling (`@hey-api/openapi-ts`, Huma) can change generated files; the contract job fails until `make generate` is run and committed on that branch.
