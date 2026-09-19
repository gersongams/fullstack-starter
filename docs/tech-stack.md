# Tech stack

Versions are the ones installed on 2026-09-18. `apps/api/go.mod` and `apps/web/package.json` are authoritative.

## Backend (`apps/api`)

| Tool | Version | Used for | Why this one |
| --- | --- | --- | --- |
| Go | 1.27 | Language | Fast, small static binaries, strong standard library |
| [Huma](https://huma.rocks) | 2.39.1 | API framework | Generates OpenAPI 3.1 from Go types, validates input, standard error format (RFC 9457 problem details) |
| [chi](https://github.com/go-chi/chi) | 5.3.2 | Router under Huma | 100% `net/http` compatible, so any standard middleware works and there is no framework lock-in |
| [pgx](https://github.com/jackc/pgx) | 5.11.0 | Postgres driver and pool | The native Postgres driver for Go; no ORM, no reflection |
| [goose](https://github.com/pressly/goose) | 3.28.0 | Migrations | Plain SQL files embedded in the binary; `api migrate` needs no extra tooling in production |
| [jwx](https://github.com/lestrrat-go/jwx) | 3.3.0 | JWT and JWKS | Supports EdDSA (Ed25519), which Better Auth signs with by default |
| [sqlc](https://sqlc.dev) | 1.31.1 | Query code generation | Type-checked Go from plain SQL, checked against the migrations at generate time. No ORM. Pinned in the Makefile and CI |
| `log/slog` | stdlib | Logging | Structured logging without a dependency |
| [tint](https://github.com/lmittmann/tint) | 1.2.0 | Development log output | A slog handler: coloured, compact lines in a terminal. Production stays on slog's JSON handler |
| [httprate](https://github.com/go-chi/httprate) | 0.16.0 | Rate limiting | From the chi authors; per-address and per-user limits with a pluggable counter |
| [Prometheus client](https://github.com/prometheus/client_golang) | 1.24.1 | Metrics | The de facto standard; `/metrics` with HTTP, pool and runtime metrics |
| [OpenTelemetry Go](https://opentelemetry.io/docs/languages/go/) | 1.46.0 | Tracing | Vendor-neutral; `otelhttp` for the server, `otelpgx` for queries, OTLP export configured by `OTEL_*` variables |
| `google/uuid` | 1.6.0 | UUID type | What sqlc maps `uuid` columns to |
| golangci-lint | v2 | Linting | Config in `apps/api/.golangci.yml`; run with `go run`, see [Backend](backend.md#linting) |

## Frontend (`apps/web`)

| Tool | Version | Used for | Why this one |
| --- | --- | --- | --- |
| [Next.js](https://nextjs.org) | 16.3.5 | Framework (App Router) | Turbopack is the default bundler, `proxy.ts` replaces middleware, typed routes |
| React | 19.2.8 | UI | React Compiler is enabled, so manual `useMemo`/`useCallback` are rarely needed |
| [Better Auth](https://better-auth.com) | 1.7.5 | Sign-up, sign-in, sessions, API tokens | Runs inside the app, owns its tables, JWT plugin publishes a JWKS that Go can verify |
| [TanStack Query](https://tanstack.com/query) | 5.103 | Data fetching and cache | Parallel requests, cancellation, retries, cache invalidation |
| [Hey API `openapi-ts`](https://heyapi.dev) | 0.99 | TypeScript client generation | Emits types, zod schemas, an SDK that validates responses with them, and TanStack Query options from the OpenAPI document. Pre-1.0, so the version is pinned by the lockfile |
| Tailwind CSS | 4 | Styling | |
| [shadcn/ui](https://ui.shadcn.com) | 4.21 (CLI) | Components | Copied into `src/components/ui`, so they are ours to change; Radix underneath for accessibility. `shadcn` itself is a devDependency, needed only for its CSS at build time |
| React Hook Form + Zod | 7.88 / 4.6 | Forms and validation | The one form convention; the zod schema mirrors the API's limits, and API problem details are mapped back onto fields |
| sonner, lucide-react | 2.0 / 1.47 | Toasts, icons | What shadcn's components use |
| [nodemailer](https://nodemailer.com) | 10.0 | Outgoing mail over SMTP | Provider-neutral: any SMTP endpoint in production, Mailpit locally |
| [Vitest](https://vitest.dev) | 5.0 | Unit tests | Fast, native TypeScript and ESM |
| [Playwright](https://playwright.dev) | 1.63 | End-to-end tests | Drives a real browser against both apps; reads Mailpit to follow emailed links |
| [Oxlint](https://oxc.rs) | 1.83 | Linting | Fast; project preference over Biome and ESLint |
| [oxfmt](https://oxc.rs) | 0.68 | Formatting | Same toolchain as Oxlint. Pre-1.0: upgrades can reformat files, so upgrade it in its own commit |
| TypeScript | 5.x | Types | Not 7 yet: `openapi-ts` generates code through the TypeScript compiler API, which TypeScript 7 does not provide yet |
| `@vercel/otel` | latest | Tracing | The setup the Next.js docs recommend; off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set |
| `pg` | 8.23 | Postgres client for Better Auth | |

## Data and infrastructure

| Tool | Version | Used for |
| --- | --- | --- |
| PostgreSQL | 18 | The only datastore. Version 18 brings native `uuidv7()`, async I/O and `WITHOUT OVERLAPS` constraints |
| Docker Compose | | Local Postgres and Mailpit; both apps run on the host in development. `compose.prod.yaml` overlays the production images |
| [Mailpit](https://mailpit.axllent.org) | 1.27 | Catches all development mail; inbox at http://localhost:18025 |
| pnpm | 12.4 | JS package manager, workspace rooted at the repository root |
| [Turborepo](https://turborepo.dev) | 2.10 | Runs `dev`, `build`, `test`, `lint`, `typecheck` for both apps with caching; the Go app joins through a script-only `package.json` |
| [lefthook](https://lefthook.dev) | 2.1 | Git hooks: format and lint staged files, contract check before push |
| Make | | Task runner. Chosen because it is already installed everywhere; `task` and `mise` were not available on the first development machine |
| GitHub Actions | | CI: API, web, contract drift, container builds, end-to-end; a release workflow; Dependabot |
| Distroless / `node` images | | Production containers, both run as non-root |

## Chosen but not added yet

These were selected during the stack research and will be added when the first feature needs them.

| Tool | Planned use |
| --- | --- |
| [River](https://riverqueue.com) | Background jobs stored in Postgres, enqueued transactionally |
| TanStack Table + Virtual | Large tables |
| next-intl | Locales, currency and number formats |
| nuqs | Filters and pagination in the URL |

## Considered and rejected

| Option | Reason |
| --- | --- |
| Fiber | Fastest in benchmarks but built on fasthttp, which is incompatible with `net/http` middleware and OpenTelemetry. The database is the bottleneck, not the router |
| GORM | Reflection-heavy and hides the SQL; a poor fit for reporting queries |
| ConnectRPC | Most reliable code generation, but protobuf on the wire makes a future public REST API harder |
| Auth.js | In maintenance mode since it moved under the Better Auth team |
| Biome | Project preference for the Oxc toolchain |
| Server Actions as the data layer | See [Architecture](architecture.md#queries-and-mutations-go-from-the-browser-to-go-not-through-server-actions) |
