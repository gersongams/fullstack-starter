# Fullstack Starter

A production-minded starting point: a Go API and a Next.js web app sharing one Postgres database, with authentication and one reference feature (`clients`) built end to end, from the migration to the tested UI, as the pattern every new feature copies.

What is already decided and wired, so a new project starts at the first real feature:

- **Contract first.** The Go code generates the OpenAPI spec, which generates the TypeScript client, its zod schemas and the TanStack Query options. CI fails when any of them is stale.
- **Auth that is finished.** Better Auth sessions, short-lived JWTs the Go API verifies through JWKS, email verification, password reset, rate limiting, and redirects that cannot loop or be abused.
- **A feature to copy.** Ownership enforced in SQL, cursor pagination, soft delete, idempotent creates, problem-details errors mapped onto form fields.
- **Tests that run for real.** Go tests against real Postgres, Vitest, and Playwright across both apps, including the emailed links.
- **Operations.** Structured logs with request and trace IDs, Prometheus metrics, OpenTelemetry tracing, migrations under an advisory lock, container images, a release workflow, Dependabot.
- **Guardrails.** `.claude/skills/` records the classes of bug that code review found while this was built, so neither people nor coding agents reintroduce them.

## Use this template

1. On GitHub, **Use this template**, then clone your new repository.
2. Rename it once:

   ```sh
   node scripts/rename.mjs --name acme-billing --title "Acme Billing" --module github.com/acme/acme-billing
   ```

   That sets the package and image names, the Go module path, the JWT audience, the service names, the UI title and the local database name.
3. `make setup && make generate && make test lint`, then commit.
4. Replace `clients` with your first real resource, following [Backend](docs/backend.md#adding-a-resource) and [Frontend](docs/frontend.md). Keep `clients` around until then: it is the worked example.

The repository ships without a licence file. Add the one you want before publishing your project.

| Part | Path | Stack |
| --- | --- | --- |
| API | `apps/api` | Go 1.27, Huma v2 on chi, pgx + sqlc, goose, slog, Prometheus, OpenTelemetry |
| Web | `apps/web` | Next.js 16, React 19, Better Auth, TanStack Query, shadcn/ui on Tailwind 4, react-hook-form + zod, Vitest, Playwright, Oxlint + oxfmt |
| Contract | `openapi/openapi.yaml` | Generated from the Go code; the TypeScript client is generated from it |
| Database | `compose.yaml` | PostgreSQL 18 |
| Tooling | root | Turborepo, Make, GitHub Actions, Dependabot |

Full documentation is in [`docs/`](docs/README.md): architecture, tech stack, authentication, backend, frontend, database, and development and operations.

## How a protected call works

1. The user signs in through Better Auth, which runs inside the Next.js app and stores users and sessions in the `auth` Postgres schema. The session is an httpOnly cookie.
2. The browser asks Better Auth for a short-lived JWT (`/api/auth/token`, 15 minutes, EdDSA) and caches it in memory.
3. The browser calls `/api/v1/*` on its own origin with `Authorization: Bearer <jwt>`. Next.js rewrites those paths to the Go API, so there is no CORS and no second public origin.
4. The Go API verifies the signature against Better Auth's public keys (`/api/auth/jwks`), plus issuer, audience and expiry, then runs the handler. It never trusts the web app's say-so.

## Getting started

Requirements: Go 1.27+, Node 24+, pnpm 12+, Docker.

```sh
make setup     # env files, dependencies, Postgres, migrations
make dev       # migrates, then runs both apps through Turborepo: API on http://localhost:8787, web on http://localhost:3100
```

`make dev-api` and `make dev-web` run one app at a time.

Open http://localhost:3100 and create an account, or run `make seed` for a demo account with sample clients. In development the API docs are at http://localhost:8787/api/v1/docs.

```sh
make test lint   # Go tests against real Postgres, Vitest, go vet, Oxlint, TypeScript
make e2e         # Playwright, with `make dev` running
make check       # generated code is up to date
```

Run `make help` for every target.

## Adding a feature

`clients` is the reference: a goose migration, sqlc queries that all filter by `user_id`, a store with sentinel errors, Huma operations with validation and cursor pagination, tests against real Postgres, then the generated client, a page with the shared form convention, and a Playwright spec. [Backend](docs/backend.md#adding-a-resource) and [Frontend](docs/frontend.md) walk through it.

The Go code is the source of truth for the contract, and the SQL files for the queries.

```sh
make generate  # sqlc, then openapi/openapi.yaml, then apps/web/src/lib/api/gen
```

Commit all three. CI runs `make check` and fails when any is stale.

## Logging

The API logs to stderr with `log/slog`: JSON when `APP_ENV=production`, compact coloured lines in development, at `LOG_LEVEL` (default `info`).

- Every request gets an `X-Request-Id` (an incoming one is reused) that is returned to the caller and attached to every log line of that request, along with `user_id` once the token is verified.
- One access-log line per request: `info` for 2xx/3xx, `warn` for 4xx, `error` for 5xx. Successful health probes are not logged.
- Panics are recovered, answered with a 500 and logged with their stack trace.
- Tokens, emails and request bodies are never logged.

Inside handlers, log with the `*Context` methods (`logger.InfoContext(ctx, ...)`) so the request attributes are included.

Metrics are at `/metrics` (Prometheus) and tracing turns on when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; traced requests carry `trace_id` in their log lines. See [Backend](docs/backend.md#observability).

## Configuration

Both apps read environment variables only. See `apps/api/.env.example` and `apps/web/.env.example`. `AUTH_ISSUER` and `AUTH_AUDIENCE` in the API must match the JWT settings of the web app.

## Production notes

- [Deployment](docs/deployment.md) covers the images, the release workflow and the migrate-then-rollout order. `make prod-up` runs the production images locally.
- The API is rate limited per client address and per user. `TRUSTED_PROXIES` decides whose `X-Forwarded-For` is believed; read [the table](docs/backend.md#rate-limiting) before setting it, because Next.js forwards the browser's header unchanged.
- `apps/api/Dockerfile` builds a static binary on a distroless, non-root image. Run `/api migrate` as a release step before starting new instances, or set `MIGRATE_ON_START=true`; migrators take turns on an advisory lock either way.
- `/healthz` is the liveness probe and `/readyz` the readiness probe (it pings Postgres).
- The API docs and the spec endpoint are disabled when `APP_ENV=production`.
- Keep the API and the database in the same region, and point `API_INTERNAL_URL` at the API's private address.
