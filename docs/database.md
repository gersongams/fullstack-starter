# Database

One PostgreSQL 18 database, two schemas, two owners.

| Schema | Owner | Managed with | Contents today |
| --- | --- | --- | --- |
| `auth` | Web app (Better Auth) | Better Auth CLI: `pnpm --filter web db:migrate` | `user`, `session`, `account`, `verification`, `jwks` |
| `public` | Go API | goose: `api migrate` | `goose_db_version`, `clients`, `idempotency_keys`, `rate_limit_counters` |

The schema itself (`CREATE SCHEMA auth`) is created by the API's first goose migration, so the order is always: API migrations first, then Better Auth's. `make migrate` runs both in that order.

Better Auth reaches its schema through the connection option `-c search_path=auth` (`apps/web/src/lib/auth.ts`). The Go API uses the default search path and never reads or writes `auth` tables. When the API needs user data beyond the token claims, reference users by their ID (`auth."user".id`, a text value that arrives as the token's `sub`).

## Application migrations (goose)

Migrations are SQL files in `apps/api/internal/db/migrations`, embedded in the API binary.

```sh
cd apps/api
goose -s -dir internal/db/migrations create add_projects sql   # creates 00002_add_projects.sql
cd ../.. && make migrate
```

File format:

```sql
-- +goose Up
CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    ...
);

-- +goose Down
DROP TABLE projects;
```

Rules:

- Number files sequentially (`00002_...sql`). Never edit a migration that has been applied anywhere else; add a new one.
- `db.Migrate` holds a Postgres advisory lock while it works, so two migrators (instances starting together, or a release step overlapping a deploy) never apply the same migration twice: one does the work, the others wait and then find nothing pending. `TestConcurrentMigrateAppliesEachMigrationOnce` runs five at once against an empty database.
- In production, the default is to run `api migrate` as a release step before starting new instances. See the next section for the alternative.
- Run migrations over a direct connection, not through a transaction-mode pooler.

## When migrations run

| Where | API tables (goose) | Better Auth tables |
| --- | --- | --- |
| `make dev` | Runs `make migrate` first | Same |
| API started any other way in development (`make dev-api`, `go run`) | On start: `MIGRATE_ON_START` defaults to `true` | Not covered: `make migrate` |
| Tests | `dbtest.New` migrates each test database | Not needed |
| `make prod-up` | The one-shot `migrate` service | The one-shot `auth-migrate` service |
| Production | `api migrate` as a release step, or `MIGRATE_ON_START=true` | `pnpm --filter web db:migrate` from a checkout of the tag, only after upgrading Better Auth or adding a plugin |

`MIGRATE_ON_START` is the equivalent of TypeORM's `migrationsRun`: pending migrations are applied before the server listens, so no request meets an old schema, and a failed migration stops the start. It defaults to `true` in development and `false` in production, where it is a decision rather than a default:

- **On** suits a small deployment: one fewer release step, and the advisory lock makes several instances safe.
- **Off** suits long or risky migrations: with it on, a slow migration holds back every new instance, and a migration that needs the old code to keep running during the change (expand, deploy, contract) cannot be sequenced.

There is deliberately no equivalent of TypeORM's `synchronize` (deriving the schema from entity classes). The migrations are the schema, sqlc generates the Go types from them, and nothing alters a table without a reviewed SQL file. Better Auth's CLI does diff its expected tables against the `auth` schema; that is acceptable there because it owns those tables and its changes are additive.

## Support tables

| Table | Purpose | Notes |
| --- | --- | --- |
| `idempotency_keys` | One row per `(user_id, key)` with a hash of the request and the stored response. See [Backend](backend.md#idempotency) | Written in the same transaction as the work it protects. Rows older than 24 hours are purged hourly |
| `rate_limit_counters` | Shared rate-limit windows when `RATE_LIMIT_STORE=postgres` | `UNLOGGED`: no WAL, so the per-request write is cheap, and a crash only resets the windows. The key is a hash, so no address or user ID is stored. Rows older than 10 minutes are purged hourly |

The purge runs inside the API process (`internal/maintenance`): two indexed deletes, safe to run from every instance, no scheduler needed.

## Transactions

Use `db.InTx` and bind the generated queries with `queries.WithTx(tx)`; keep the transaction inside one store method. See [Backend](backend.md#transactions).

## Queries (sqlc)

SQL lives in `apps/api/internal/db/queries/*.sql`; [sqlc](https://sqlc.dev) reads the goose migrations as the schema and generates type-safe Go into `internal/db/dbgen` (`apps/api/sqlc.yaml`). `uuid` maps to `github.com/google/uuid`, `timestamptz` to `time.Time`, and nullable columns to pointers.

```sh
make generate   # sqlc, then the OpenAPI spec, then the TypeScript client
```

The sqlc version is pinned in the Makefile (`SQLC`) and in the CI contract job; keep them in step. `make check` fails when `dbgen` is stale or has an untracked file. A query that does not match the schema fails at generate time, not at runtime.

## Better Auth migrations

`pnpm --filter web db:migrate` compares Better Auth's expected tables (from the config and its plugins) with the `auth` schema and applies the difference. Run it after upgrading Better Auth or adding a plugin.

## Conventions for application tables

Decided during the stack research; apply them from the first table:

- **Primary keys:** `uuid` with `DEFAULT uuidv7()`. Time-ordered, so indexes stay compact.
- **Money:** `bigint` minor units plus a currency code. `numeric` for rates, taxes, quantities and unit prices. Never `float`, never the `money` type.
- **Timestamps:** `timestamptz`.
- **Ownership:** the system is single-user: every row belongs to one user. Each table has `user_id text NOT NULL` (the token's `sub`, `auth."user".id`), it is the first column of every index that serves a query, and every sqlc query filters by it. There is no foreign key to `auth."user"`: Better Auth creates its tables after the API's migrations and owns their lifecycle.
- **Soft delete:** `deleted_at timestamptz`. Queries filter `deleted_at IS NULL`; unique indexes are partial on it so a deleted row does not block a new one. Deleted records stay traceable.
- **`updated_at`:** set by the `UPDATE` statement (`updated_at = now()`), not by a trigger.
- **Constraints carry the rules:** `CHECK` for what must always hold, a named unique index for what must not repeat. The store maps the constraint name to a sentinel error (see `internal/clients`).

## Local database

`compose.yaml` runs `postgres:18` with user, password and database all set to `starter`, on host port `54320`.

```sh
make db-up      # start and wait until healthy
make db-down    # stop; the data volume is kept
docker compose exec postgres psql -U starter -d starter
make db-reset   # delete the data volume and migrate again
make seed       # demo account with sample clients (needs `make dev` running)
```

Postgres 18 images keep their data under `/var/lib/postgresql`, not `/var/lib/postgresql/data`; the volume is mounted accordingly.
