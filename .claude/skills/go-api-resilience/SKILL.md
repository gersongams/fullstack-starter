---
name: go-api-resilience
description: Guardrails for failure-mode correctness in the Go API (apps/api). Use this whenever you write or change code that calls another service or caches a remote result (JWKS, HTTP clients, anything behind a mutex), maps errors to HTTP statuses or log levels (auth middleware, handlers), reads environment variables / config, adds a goose migration, adds a resource, table, sqlc query or handler that touches user-owned data, writes database tests, or reads a client IP / forwarded header (rate limiting, logging). Also use it when reviewing such code. If the change touches apps/api/internal/auth, internal/config, internal/db/migrations or adds an outbound dependency, consult this first — these are the places where happy-path code has already produced outages in review.
---

# Go API resilience guardrails

Every rule below is a bug that was found in this repo. The common thread:
the code was correct when everything worked and wrong when a dependency was
slow, down, or misconfigured. When you write this kind of code, ask "what
happens on the 100th request while the other side is down?"

## 1. Caches in front of remote calls

Applies to the JWKS cache in `internal/auth/verifier.go` and anything like it.

- **Don't hold a mutex across network I/O.** One slow fetch then serialises
  every request behind it (N requests × client timeout), even when perfectly
  good cached data exists. Lock only to read/swap the cached value; coalesce
  concurrent refreshes into a single fetch (singleflight or an in-flight marker).
- **Record failed attempts too.** If only a *successful* fetch advances the
  timestamp, a down dependency means one fetch per request — and any
  rate limit (`minRefetch`) is bypassed exactly when it matters, which also
  lets unauthenticated callers trigger outbound requests at will.
- **Serve stale on failure.** Expired-but-valid cached data beats an error.
- **Retry only if something changed.** "Unknown key → refetch → verify again"
  is only worth it if the refetch really happened and returned a new set.
  Otherwise every garbage token costs two signature verifications.
- Keep an explicit client timeout. A fetch shared by several requests runs on
  a context detached from any single caller, so one cancelled request doesn't
  fail everyone waiting on it.

`keySet` / `fetch` / `staleOr` and `fetchBackoff` in the verifier show the shape.

Test these with a fake server: count fetches under failure, assert stale keys
are served, assert concurrent callers share one fetch. Run with `-race`.

## 2. Classify errors before choosing a status or log level

"The token is bad" and "I could not check the token" are different facts.

| Situation | Status | Log |
|---|---|---|
| Missing/malformed/expired/wrongly signed token | 401 | `Warn` |
| Dependency unavailable (no JWKS and cannot fetch, DB down, …) | 503 | `Error` |

Why: answering 401 to a valid token makes the web app treat the user as signed
out, and logging an outage at `Warn` means level-based alerting never fires.
Expose the distinction as a sentinel/typed error from the lower layer
(`errors.Is` / `errors.As`), never by matching error strings. The reference is
`auth.ErrKeysUnavailable` in `internal/auth/verifier.go`, mapped to 503 in
`internal/auth/middleware.go`. An operation with `Security: auth.Required`
lists both `http.StatusUnauthorized` and `http.StatusServiceUnavailable` in
`Errors`, otherwise the 503 is missing from the OpenAPI contract.

Log with slog's `*Context` methods; never log tokens, emails or bodies.
If the set of documented responses changes, run `make generate` and commit the
spec and client (see the `repo-tooling-guardrails` skill).

## 3. Config: validate and fail closed

`config.Load()` is the only place a bad deploy can be caught before it serves traffic.

- Enumerated values (`APP_ENV`) are validated against the allowed set and
  anything else is a startup error. Never let "not exactly `production`" mean
  "development": `APP_ENV=prod` would silently publish `/api/v1/docs` and
  switch logs from JSON to text.
- Security-relevant defaults are the *safe* ones; the permissive behaviour
  must be opted into explicitly.
- Range-check numbers (`PORT` 1–65535), parse URLs and durations at load time.
- Every new variable gets: validation, a test for the rejected case, an entry
  in `.env.example`, and a line in `docs/`.

## 4. Migrations: only drop what this API owns

The `auth` schema is created by goose but its tables (`user`, `session`,
`account`, `jwks`) are created and owned by Better Auth's CLI.

- A `Down` must only undo what its own `Up` created. `DROP SCHEMA auth` fails
  once Better Auth's tables exist, and `CASCADE` would silently delete every
  user — so for shared objects `Down` is a documented no-op.
- Before writing any `DROP … CASCADE`, list what it would take with it.
- Anything that calls `db.Migrate` may run beside another migrator (instances
  starting together with `MIGRATE_ON_START`, a release step during a deploy).
  The advisory lock inside `Migrate` is what makes that safe; don't add a
  second migration path that bypasses it.
- With `MIGRATE_ON_START`, a migration runs while the OLD code may still be
  serving. Make schema changes backward compatible (add, deploy, then remove in
  a later release) or use the explicit `api migrate` step to sequence them.
- New API-owned tables go in a schema the API fully owns; check the `Down`
  actually runs against a database that has been through `make migrate`.

## 5. User-owned data: scope in SQL, not in handlers

The system is single-user: every row has `user_id`. `internal/clients` is the reference.

- Every sqlc query takes `user_id` and filters by it, including `UPDATE` and
  `DELETE`. A handler that "checks the owner first" is one forgotten check
  away from a data leak; a query that cannot return another user's row is not.
- Store methods take the caller's user ID as an argument, and the ID comes
  from `auth.UserFrom(ctx)` only, never from the request body or path.
- "Not yours" and "does not exist" are the same 404. A 403 tells an attacker
  the ID is real.
- Test it for every method: create as one user, then GET, PUT, DELETE and list
  as another (`TestClientsAreInvisibleToOtherUsers`).
- Map constraint names to sentinel errors in the store (`translate`); anything
  unmapped is logged and answered with a generic 500, never echoed to the caller.

## 6. Database tests fail, they don't skip

`dbtest.New(t)` gives each test its own migrated database. When Postgres is
unreachable it calls `t.Fatal`. Don't change that to `t.Skip`: a skipped
database test lets CI go green without having run, which is how an ownership
bug ships. `make test` starts Postgres; CI does the same.

## 7. Forwarded headers are attacker input

`X-Forwarded-For`, `X-Real-IP` and friends are set by whoever sends the
request. Keying a rate limit (or an audit log) on them lets an attacker rotate
the header to dodge the limit, or pin it to a victim's address to lock them
out. `httprate.KeyByRealIP` and chi's `middleware.RealIP` are deprecated for
exactly this reason.

- Believe the header only when the connection's socket address is inside
  `TRUSTED_PROXIES`, then take the first address, right to left, that is not a
  trusted proxy (`clientIP` in `internal/httpapi/ratelimit.go`).
- Everything else is keyed on the socket address.
- Know what each hop does to the header before trusting it. Next.js forwards
  the browser's `X-Forwarded-For` through its rewrite unchanged and adds
  nothing (verified with a header-echo server behind `next start`), so the web
  app belongs in `TRUSTED_PROXIES` only when a load balancer in front of it
  appends the real address. Test the chain; don't assume a proxy appends.
- Per-IP limits run before auth (bad tokens still cost a signature check);
  per-user limits run after it. Both are needed.
- A deprecation warning from the linter on a security-relevant helper is a
  finding, not noise: read why it was deprecated before suppressing it.

## 8. Writes that can be retried: idempotency inside the transaction

A create that a client may retry (double click, timeout, queue redelivery)
takes an `Idempotency-Key`. `clients.Store.Create` is the reference.

- Claim the key, do the work and store the response in ONE transaction
  (`db.InTx` + `idempotency.Do`). Claiming it in a separate statement first
  leaves a key behind when the work fails, and the caller can then never retry.
- Only successes are remembered. An error rolls the claim back.
- Scope keys by user, and compare a hash of the request: the same key with a
  different body is a 422, never a replay of something else.
- Test the concurrent case with `-race`: N goroutines, one key, one row.

## 9. A protective layer must not become the outage

The Postgres rate-limit counter fails open: when its store is unreachable it
logs a warning and lets the request through (`TestPostgresCounterFailsOpen`).
Anything that guards the API but is not the API (rate limiter, metrics, error
reporter, tracing exporter, purge job) follows the same rule: bounded time,
logged failure, request continues. A `Reporter` hands off to a queue and
returns; it never blocks a request on the network.

## Verify

```sh
make db-up && cd apps/api && go test -race ./...
cd apps/api && go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest run ./...
```

(The globally installed golangci-lint is v1 and cannot read the v2 config.)
