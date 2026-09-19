# Documentation

Start with the architecture overview, then read the page for the part you are working on.

| Page | What it covers |
| --- | --- |
| [Architecture](architecture.md) | The parts of the system, how a request travels through them, the repository layout, and the decisions behind the design |
| [Tech stack](tech-stack.md) | Every tool and library in use, its version, why it was chosen, and what was deliberately left out for now |
| [Authentication](authentication.md) | Sessions, API tokens, how the Go API verifies them, email verification, password reset, rate limiting and where the client address comes from, route protection, and the security properties of the setup |
| [Backend](backend.md) | The Go API: package layout, the request pipeline, rate limiting, adding a resource (with `clients` as the reference), pagination, transactions, idempotency, errors, logging, observability, configuration, tests |
| [Frontend](frontend.md) | The Next.js app: routes, the app shell and UI kit, the form convention, the generated API client, data fetching, error reporting, tracing, testing, linting and formatting |
| [Database](database.md) | Postgres schemas, who owns which tables, migrations, sqlc queries, table conventions, support tables, transactions |
| [Development and operations](development.md) | Local setup, Make targets, Turborepo, ports, environment variables, git hooks, CI, container images |
| [Deployment](deployment.md) | The production-like compose stack, production environment variables, the release order (migrations, then rollout), the release workflow, Dependabot and the security scans |

The project `README.md` at the repository root has the quick start.
