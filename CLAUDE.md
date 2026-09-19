# Fullstack Starter

Go API (`apps/api`) + Next.js web app (`apps/web`) + Postgres 18. See `README.md` for setup and `docs/` for the architecture, auth flow and conventions; keep `docs/` up to date when behaviour changes. `apps/web/AGENTS.md` has Next.js-specific rules; read it before editing the web app.

## Commands

- `make help` lists every target. Most used: `make dev` (migrates, then both apps), `make test` (starts Postgres; Go tests create their own databases), `make lint`, `make generate`, `make e2e` (Playwright, needs `make dev` running), `make seed`, `make db-reset`.
- `dev`, `build`, `test`, `lint`, `typecheck` and `format:check` run through Turborepo (`turbo.json`); `apps/api/package.json` only maps those names onto `go` commands. One app: `pnpm turbo run <task> --filter=api|web`.
- Go lint: `cd apps/api && go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest run ./...` (the globally installed golangci-lint is v1 and cannot read the v2 config).

## Conventions

- The Go code is the source of truth for the API contract, and SQL in `apps/api/internal/db/queries` is the source of truth for queries (sqlc). After changing an operation or a query, run `make generate` and commit `openapi/openapi.yaml`, `apps/web/src/lib/api/gen` and `apps/api/internal/db/dbgen` with it. Never edit generated files by hand.
- `clients` is the reference resource (`docs/backend.md`, "Adding a resource"). The system is single-user: every table has `user_id`, every query filters by it, and someone else's row is a 404.
- Migrations are SQL files and the only way the schema changes; no schema sync from models. The API applies them on start when `MIGRATE_ON_START=true` (default in development only), under an advisory lock.
- Create operations take an optional `Idempotency-Key`: claim it, do the work and store the response in one `db.InTx` transaction with `idempotency.Do` (`clients.Store.Create` is the example).
- No error-tracking vendor SDK, by decision. The hooks are `logging.Reporter` in the API and `src/lib/error-reporter.ts` in the web app.
- Protected operations set `Security: auth.Required`; handlers read the caller with `auth.UserFrom(ctx)`.
- Log with slog's `*Context` methods so `request_id` and `user_id` are attached. Never log tokens, emails or request bodies.
- The web app talks to Go through TanStack Query and the generated client, not Server Actions.
- JS/TS linting and formatting is Oxlint + oxfmt. No Biome, ESLint or Prettier.
- Local ports: web 3100, API 8787, Postgres 54320, Mailpit 10025 (SMTP) and 18025 (inbox UI).

## Skills

`.claude/skills/` holds guardrails distilled from code review. Load the matching one before editing these areas and extend it when a review finds a new class of bug:

- `web-auth-session`: proxy and redirects, sign-in/out UI, the API token cache.
- `go-api-resilience`: remote-call caches, error to status/log-level mapping, config validation, migrations.
- `repo-tooling-guardrails`: Makefile and CI checks, generated files, pnpm only.
