# Development and operations

## Requirements

Go 1.27+, Node 24+, pnpm 12+, Docker, Make.

## First run

```sh
make setup     # env files (with a generated BETTER_AUTH_SECRET), pnpm install, Postgres, all migrations
make dev       # Postgres, then both apps in one terminal (Turborepo TUI: arrow keys switch logs, Ctrl-C stops both)
```

Open http://localhost:3100 and create an account.

## Local ports

| Service | Port | Note |
| --- | --- | --- |
| Web app | 3100 | |
| Go API | 8787 | API docs at `/api/v1/docs` in development |
| Go API | 8787 | Prometheus metrics at `/metrics` |
| Postgres | 54320 | Override with `POSTGRES_PORT` when starting Compose |
| Mailpit SMTP | 10025 | Where the web app sends mail in development. Override with `MAILPIT_SMTP_PORT` |
| Mailpit inbox | 18025 | Read verification and reset emails here. Override with `MAILPIT_UI_PORT` |

The usual defaults (3000, 8080, 5432) were already taken on the first development machine. If you change a port, update `apps/api/.env`, `apps/web/.env.local` and, for the web port, the `dev` and `start` scripts.

## Make targets

| Target | Does |
| --- | --- |
| `make help` | Lists every target |
| `make setup` | First-time setup |
| `make db-up`, `make db-down` | Start or stop Postgres and Mailpit. Mailpit catches all outgoing mail; read it at http://localhost:18025 (SMTP on 10025, override with `MAILPIT_SMTP_PORT` / `MAILPIT_UI_PORT`) |
| `make db-reset` | Delete the Postgres volume and migrate again. Every local row is lost |
| `make seed` | Demo account (`demo@example.com`) with sample clients, created through the public APIs. Needs `make dev` running |
| `make migrate` | API migrations, then Better Auth's |
| `make dev` | Start Postgres and Mailpit, apply both sets of migrations, then run both apps through Turborepo |
| `make dev-api`, `make dev-web` | Run one app |
| `make build` | Build both apps (`apps/api/bin/api` and `.next`) |
| `make sqlc` | Regenerate `apps/api/internal/db/dbgen` from the migrations and queries |
| `make openapi` | `sqlc`, then re-export `openapi/openapi.yaml` from the Go code |
| `make generate` | `openapi`, then regenerate the TypeScript client |
| `make test` | Starts Postgres, then `turbo run test`: Go tests with the race detector (they create their own databases) and Vitest |
| `make e2e` | Playwright against a running `make dev` |
| `make lint` | `turbo run lint typecheck`: `go vet`, Oxlint, TypeScript |
| `make check` | `generate`, then fail if the committed query code, contract or client changed or has untracked files |
| `make prod-up`, `make prod-down` | Build and run the production images locally. See [Deployment](deployment.md) |

## Environment files

| File | Committed | Purpose |
| --- | --- | --- |
| `apps/api/.env.example` | yes | Template with working local values |
| `apps/api/.env` | no | Loaded by `make dev-api` and `make migrate` |
| `apps/web/.env.example` | yes | Template; `BETTER_AUTH_SECRET` is empty |
| `apps/web/.env.local` | no | Loaded by Next.js and by `db:migrate` |

Variable references: [Backend](backend.md#configuration), [Frontend](frontend.md#configuration). The issuer, audience and JWKS URL must agree between the two apps; see [Authentication](authentication.md#verification-in-go).

## Everyday workflow

Changing the API:

1. Edit the Go operation, or the SQL in `apps/api/internal/db/queries`.
2. `make generate`.
3. Fix the TypeScript errors the new client surfaces.
4. `make test lint`, and `make e2e` with `make dev` running when the UI changed.
5. Commit the Go change with `apps/api/internal/db/dbgen`, `openapi/openapi.yaml` and `apps/web/src/lib/api/gen`.

Adding a feature end to end: follow `clients`, described in [Backend](backend.md#adding-a-resource) and [Frontend](frontend.md). Adding a table: see [Database](database.md#application-migrations-goose).

After pulling: `pnpm install` (it also installs the git hooks), then restart `make dev`, which migrates before it starts the apps. A running `make dev` does not pick up a new migration, a new environment variable or a rebuilt Go binary.

## Turborepo

`turbo.json` defines the tasks `dev`, `build`, `test`, `lint`, `typecheck` and `format:check`; the root `package.json` scripts and the Make targets above call them. Turborepo only sees workspace packages, so `apps/api/package.json` exists purely to map those task names onto `go` commands. It has no JS dependencies.

- Run anything for one app with a filter: `pnpm turbo run test --filter=api`.
- Results are cached in `.turbo/` by input hash, so an unchanged package is skipped (`FULL TURBO`). Add `--force` to rerun.
- Tasks run with a filtered environment. A new variable that a build or typecheck reads must be added to that task's `env` in `turbo.json`, otherwise the task does not see it and the cache does not vary with it. `GO*` and `CGO_ENABLED` are passed through for the Go toolchain.
- A new script only becomes a Turborepo task once it is listed in `turbo.json`.
- `make generate`, `make check` and `make migrate` stay plain Make: they write outside their package or touch the database, so caching them would be wrong.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. Five jobs:

| Job | Steps |
| --- | --- |
| **API (Go)** | `go vet`, `docker compose up` for Postgres, `go test -race` (the store and HTTP tests create their own databases), golangci-lint v2, `govulncheck` (fails only on vulnerabilities in code the API calls) |
| **Web (Next.js)** | `turbo run lint format:check typecheck test build --filter=web`: Oxlint, oxfmt check, typecheck, Vitest, production build. Then `pnpm audit --prod --audit-level=high`. Uses placeholder environment variables; nothing connects to a database |
| **API contract is up to date** | Installs the pinned sqlc, then `make check SQLC=sqlc`: regenerates the query code, the spec and the client and fails on any change, including new untracked files |
| **Container images build** | Builds both Dockerfiles with Buildx and the GitHub Actions cache. Nothing is pushed |
| **End to end (Playwright)** | `make setup` (env files, dependencies, Postgres, migrations), builds both apps, starts the API binary and the web app's standalone server (`pnpm --filter web start:standalone`, the supported way to serve `output: "standalone"`), waits for `/readyz` and `/sign-in`, then `make e2e`. Uploads the Playwright report and prints the app logs on failure |

`.github/workflows/release.yml` publishes the images to GHCR when a `v*` tag is pushed, and `.github/dependabot.yml` opens weekly update pull requests. Both are described in [Deployment](deployment.md).

The workflows have not run on GitHub yet. Locally, the same commands pass, including `govulncheck`, `pnpm audit` and both image builds.

## Container images

### API

```sh
docker build -t starter-api --build-arg VERSION=1.2.3 apps/api
```

Static binary on `gcr.io/distroless/static-debian12:nonroot`, about 25 MB, `APP_ENV=production` by default. `VERSION` (optional, `dev` otherwise) is reported as `service.version` on traces; the release workflow passes the tag. The same image runs migrations: `docker run ... starter-api migrate`.

### Web

```sh
docker build -f apps/web/Dockerfile --build-arg API_INTERNAL_URL=http://api:8787 -t starter-web .
```

The build context is the repository root, because pnpm's lockfile and workspace live there. It uses Next.js standalone output and runs as the `node` user on port 3100.

`API_INTERNAL_URL` is a **build argument**: Next.js evaluates rewrites at build time, so the API origin is baked into the image. One image therefore targets one API address. If the same image must serve several environments, move the forwarding from `next.config.ts` into `src/proxy.ts`, where it can read the variable at runtime. The other variables (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `API_JWT_AUDIENCE`, `SMTP_URL`, `MAIL_FROM`, `AUTH_*`, `OTEL_*`) are read at runtime.

## Deployment notes

Nothing is deployed yet. The plan from the stack research:

- **Database:** Neon (Postgres 18, a database branch per pull request, point-in-time restore). Runner-up: PlanetScale Postgres.
- **Web:** Vercel, with the function region set to the database's region.
- **API:** a long-running container host (Railway or Fly.io) in the same region as the database. A container host is preferred over serverless because background workers (River) need a long-lived process.

Whatever the host:

1. Run `api migrate`, then the Better Auth migration, as release steps before new instances start; or set `MIGRATE_ON_START=true` on the API and keep only the Better Auth step. [Database](database.md#when-migrations-run) has the trade-off.
2. Point the platform's liveness probe at `/healthz` and its readiness probe at `/readyz`.
3. Keep the API off the public internet if the platform allows it; only the web app needs to reach it.
4. Set `BETTER_AUTH_URL` and `AUTH_ISSUER` to the public `https://` origin of the web app, and `AUTH_JWKS_URL` to an address the API can reach.
5. Use the platform's secret store for `BETTER_AUTH_SECRET` and `DATABASE_URL`. Rotating `BETTER_AUTH_SECRET` signs everyone out and invalidates the stored signing keys.
6. If the API sits behind a load balancer that sets `X-Request-Id`, that ID is reused in the API's logs.
7. Read the `TRUSTED_PROXIES` table in [Backend](backend.md#rate-limiting) and the `AUTH_IP_HEADER` section in [Authentication](authentication.md) before going live: both rate limiters need to know where the client address comes from on your platform.
8. With more than one API instance, set `RATE_LIMIT_STORE=postgres`.
9. Set `SMTP_URL`, `MAIL_FROM` and `AUTH_REQUIRE_EMAIL_VERIFICATION=true` on the web app. Delivery through a real provider has not been exercised in this repository; send yourself a reset email after the first deploy.

[Deployment](deployment.md) has the full variable tables and the release order.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Dashboard shows "The API could not be reached" | The Go API is not running, or `API_INTERNAL_URL` was wrong when the web app was built or started |
| Every API call returns 401 with a valid session | `AUTH_ISSUER` or `AUTH_AUDIENCE` does not match the web app's `BETTER_AUTH_URL` or `API_JWT_AUDIENCE`. The API log line `rejected bearer token` states the reason |
| API logs `fetch jwks` errors | The web app is not reachable at `AUTH_JWKS_URL` |
| `next build` or `typecheck` fails with "API_INTERNAL_URL must be set" | The variable is required at build time |
| `make test` fails with "connect to Postgres" | The database tests need it: `make db-up`, or set `TEST_DATABASE_URL`. They fail rather than skip on purpose |
| No verification or reset email arrives | In development it is in Mailpit, http://localhost:18025. Check `SMTP_URL` in `apps/web/.env.local` |
| The Clients page shows an error after pulling | The running API predates the endpoint or the migration: restart `make dev`, which migrates first |
| 429 from the API for every user at once | `TRUSTED_PROXIES` is empty and all traffic shares the web app's bucket: see [Backend](backend.md#rate-limiting) |
| A commit is rejected by a hook | `gofmt -w` or `pnpm --filter web format` the listed files. `LEFTHOOK=0` skips hooks once |
| `relation "user" does not exist` on sign-up | Better Auth's migration has not run: `make migrate` |
| golangci-lint cannot parse the config | A v1 binary is installed; run v2 with `go run` as shown in [Backend](backend.md#linting) |
