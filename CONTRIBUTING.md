# Contributing

## Setup

Requirements: Go 1.27+, Node 24+, pnpm 12+, Docker, Make.

```sh
make setup   # env files, dependencies, Postgres, migrations
make dev     # Postgres, then both apps: web on :3100, API on :8787
```

`README.md` has the quick start and `docs/` explains how the parts fit. Read `docs/architecture.md` first, then the page for the part you are changing.

## Branches and commits

- Branch from `main`: `feat/...`, `fix/...`, `chore/...` or `docs/...`. Nothing is pushed to `main` directly.
- One logical change per commit. Subject in the imperative, 72 characters at most ("Add project pagination"); the body says why, not what.
- Keep pull requests small enough to review in one sitting, and fill in the template.

## Git hooks

`pnpm install` installs [lefthook](https://lefthook.dev) hooks (`lefthook.yml`): pre-commit checks the staged files with `gofmt`, oxfmt and Oxlint; pre-push runs `pnpm lint` and `make check`. Skip once with `LEFTHOOK=0 git commit ...`; CI runs the same checks either way.

## Before opening a pull request

```sh
make test lint   # starts Postgres; Go tests with the race detector, Vitest, go vet, Oxlint, TypeScript
make check       # regenerates the query code, the OpenAPI spec and the client; fails if any changed
pnpm format:check
make e2e         # Playwright, with `make dev` running in another terminal
```

CI runs the same commands, plus golangci-lint v2, `govulncheck`, `pnpm audit` and a build of both container images. To run golangci-lint locally:

```sh
cd apps/api && go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest run ./...
```

## Rules that are easy to miss

- **Generated files.** The Go code is the source of truth for the API contract. After changing an operation, or a query, run `make generate` and commit `openapi/openapi.yaml`, `apps/web/src/lib/api/gen` and `apps/api/internal/db/dbgen` in the same change. Never edit them by hand, and `git add` any new file the generator creates.
- **pnpm only.** Add web dependencies with `pnpm --filter web add <pkg>`. Never run `npm install` or `yarn`; their lockfiles are git-ignored on purpose.
- **Oxlint and oxfmt** lint and format JS/TS. Do not add Biome, ESLint or Prettier.
- **Logging.** Use slog's `*Context` methods so `request_id` and `user_id` are attached. Never log tokens, emails or request bodies.
- **Ownership.** Every table has `user_id` and every query filters by it. Someone else's row is a 404, never a 403. `clients` is the reference resource; `docs/backend.md` walks through it.
- **Migrations.** Never edit a migration that has been applied anywhere; add a new one. A `Down` only undoes what its own `Up` created.
- **Docs.** When behaviour changes, update the matching page in `docs/` in the same pull request.

## Guardrails from past reviews

`.claude/skills/` holds short checklists distilled from bugs that code review found in this repository. They are written for coding agents but are just as useful to people. Read the matching one before touching these areas, and extend it when a review finds a new class of bug:

| Skill | Read it before changing |
| --- | --- |
| `web-auth-session` | The proxy, redirects, the sign-in and sign-out UI, the API token cache |
| `go-api-resilience` | Caches in front of remote calls, error to status mapping, config validation, migrations |
| `repo-tooling-guardrails` | The Makefile, CI workflows, generated files, dependencies, Turborepo tasks |

## Security issues

Do not open a public issue for a vulnerability. Contact the maintainers privately.
