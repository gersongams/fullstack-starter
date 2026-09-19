# Frontend (Next.js app)

Read `apps/web/AGENTS.md` before changing the web app. Next.js 16 differs from earlier versions, and the matching docs ship inside `node_modules/next/dist/docs/`.

## Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Dynamic | Redirects to `/dashboard` or `/sign-in` depending on the session |
| `/sign-in`, `/sign-up` | Dynamic (Server Component), client form | Redirect into the app when the session is valid (`/sign-in` honours a validated `?next=`), otherwise render the forms built on `src/components/auth-form.tsx` and `authClient`. When email verification is required the form turns into "Check your inbox" |
| `/forgot-password` | Dynamic, client form | Asks for a reset link. Always answers the same way |
| `/reset-password` | Dynamic, client form | Landing page of the reset link: new password and confirmation, or "this link no longer works" |
| `/email-verified` | Dynamic | Landing page of the verification link: confirmed, or expired with a resend action |
| `/dashboard` | Dynamic (Server Component) | Signed-in home. Shows the identity returned by `GET /api/v1/me` |
| `/clients` | Dynamic (Server Component) | The reference feature: list with search and cursor pagination, create, edit and delete against `/api/v1/clients` |
| `/api/auth/[...all]` | Route handler | Better Auth's endpoints |
| `/api/v1/*` | Rewrite | Forwarded to the Go API. Not handled by Next.js code |

`src/proxy.ts` (the Next.js 16 replacement for `middleware.ts`) only does one optimistic redirect based on the presence of a session cookie: a signed-in section (`/dashboard`, `/clients`) without a cookie goes to `/sign-in?next=<path>`. See [Authentication](authentication.md#route-protection-in-the-web-app).

Signed-in pages live in the route group `src/app/(app)/`, whose layout renders the app shell. See [Adding a signed-in page](#adding-a-signed-in-page).

## Source layout

| Path | Contents |
| --- | --- |
| `src/app/` | Routes, the root `layout.tsx` (fonts, providers, toaster), `globals.css` (design tokens, light and dark), `global-error.tsx` (the last-resort error page) |
| `src/app/(app)/` | Signed-in pages, their shared `layout.tsx` (the app shell) and `error.tsx` (a render error keeps the shell and offers a retry). The group name is not part of the URL |
| `src/app/(app)/clients/` | The reference feature, colocated: `page.tsx`, `clients-view.tsx`, the two dialogs, `schema.ts` (zod + body mapping), `queries.ts` (cache policy) |
| `src/components/ui/` | shadcn/ui components, added with the CLI. Owned code, but keep edits small so they can be re-added |
| `src/components/app-shell.tsx` | `AppShell` (navigation, mobile sheet, skip link) and `PageHeader` |
| `src/components/user-menu.tsx` | Account menu with sign-out |
| `src/components/states.tsx` | `EmptyState`, `LoadingState`, `ErrorState` |
| `src/components/providers.tsx` | `QueryClientProvider`, one `QueryClient` per browser tab; reports unexpected API failures |
| `src/lib/error-reporter.ts` | `reportError`, the one seam for an error-reporting service (see [Error reporting](#error-reporting)) |
| `src/instrumentation.ts`, `src/instrumentation-client.ts` | Server entry point (tracing, `onRequestError`) and browser entry point (uncaught errors) |
| `scripts/start-standalone.sh` | Runs the production build the way the image does |
| `src/components/auth-form.tsx` | Shared sign-in and sign-up form |
| `src/components/auth-page.tsx` | The frame of every signed-out page |
| `src/components/forgot-password-form.tsx`, `reset-password-form.tsx` | Password reset |
| `src/components/resend-verification.tsx`, `verify-email-banner.tsx` | Resend action, and the banner the shell shows while the address is unconfirmed |
| `src/lib/mailer.ts`, `src/lib/email-templates.ts` | SMTP transport and the email bodies |
| `src/lib/redirect.ts` | `safeRedirectPath`, the only way a query parameter becomes a redirect |
| `src/lib/password.ts` | Password rules shared by the sign-up and reset forms |
| `src/hooks/` | Shared hooks (`useDebouncedValue`) |
| `src/lib/session.ts` | `getSession` and `requireSession`, the server-side session check. Server code only |
| `src/lib/api/problem.ts` | Turns the API's problem-details errors into messages and per-field form errors |
| `src/lib/env.ts` | Server-side environment variables, validated at first use. Server code only |
| `src/lib/auth.ts` | Better Auth server configuration. Server code only |
| `src/lib/auth-client.ts` | Better Auth browser client with the `jwtClient` plugin |
| `src/lib/api/token.ts` | In-memory API token cache |
| `e2e/` | Playwright specs (see [Testing](#testing)) |
| `src/lib/api/client-config.ts` | Runtime configuration of the generated client: same-origin base URL and the token callback |
| `src/lib/api/gen/` | Generated code. Never edit by hand |

## Calling the Go API

The generated client gives one `...Options()` function per query operation and one `...Mutation()` per mutating operation, ready for TanStack Query:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { getMeOptions } from "@/lib/api/gen/@tanstack/react-query.gen";

export function MeCard() {
  const me = useQuery(getMeOptions());
  // me.data is typed from the OpenAPI document: { id, email, name }
}
```

Query keys are generated too, so invalidation is typed:

```ts
queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
```

Things handled for you:

- **Base URL.** Requests go to `/api/v1/...` on the current origin.
- **Token.** Operations that declare bearer security get `Authorization: Bearer <jwt>` from `getApiToken()`.
- **Errors.** A failed request rejects with the API's problem-details body. Show `error.detail` when it is a string, and a generic "API could not be reached" message otherwise (see `src/app/dashboard/me-card.tsx`).

### How type-safe the calls are

One chain, generated end to end: Go structs and tags, `openapi/openapi.yaml`, `types.gen.ts` and `zod.gen.ts`, then the components.

| | Compile time | Runtime |
| --- | --- | --- |
| Request body, path, query and headers | Typed. A missing or misspelled field is a `tsc` error | Forms validate with their own zod schema before sending; the API is the authority |
| Response | Typed, nulls included (`tax_id: string \| null`) | **Validated.** Each SDK function parses the response with the zod schema generated from the contract (`responseValidator` in `sdk.gen.ts`) |
| Errors | `unknown` on purpose | `mapProblemToForm` and `describeProblem` inspect them defensively: a proxy's 502 is not a problem-details body |
| Drift between Go and the web app | `make generate` changes the types and `tsc` fails at each call site; `make check` fails CI and the pre-push hook when generated files are stale | A web build talking to an API of another version fails loudly (next point) |

Response validation exists for the one case types cannot cover: the deployed API and web app being different versions. A response of the wrong shape becomes a rejected query, shown with the usual error state, and reported through the error reporter as `API response did not match the contract at: items.0.created_at` (paths only, never values). Unknown extra fields are ignored, so additive API changes stay compatible; removing or retyping a field is what trips it.

There is no raw `fetch` to the API in the app, no `as any` and no `@ts-ignore`. Keep it that way: if the generated client cannot express something, fix the Go operation. `scripts/seed.mjs` and the Playwright helpers use plain `fetch` on purpose, as outside clients.

Query defaults (`providers.tsx`): 30 seconds of stale time, one retry, no refetch on window focus.

Do not use Server Actions to read or write business data. Use `useQuery` and `useMutation` with the generated options. The reasoning is in [Architecture](architecture.md#queries-and-mutations-go-from-the-browser-to-go-not-through-server-actions).

## After the API changes

```sh
make generate
```

This re-exports `openapi/openapi.yaml` from the Go code and regenerates `src/lib/api/gen`. TypeScript then reports every call site that no longer matches. Commit the generated files.

The generator is configured in `apps/web/openapi-ts.config.ts`: the fetch client, the `zod` plugin (`zod.gen.ts`, date-times accept an offset as RFC 3339 does), the SDK with response validation on and request validation off, and the `@tanstack/react-query` plugin.

## Sign-out

Sign-out lives in the account menu (`src/components/user-menu.tsx`). It does three things, in this order: `authClient.signOut()`, `clearApiToken()`, `queryClient.clear()`. Skipping the last two would leave the previous user's token and data in memory for the next person who signs in on the same tab. The last two only run when `signOut()` succeeds; on failure the menu stays open, shows the error and can be retried. `clearApiToken()` also bumps a generation counter, so a token request still in flight when it runs is discarded instead of being written back into the cache.

## Configuration

| Variable | Read | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Runtime | Postgres connection string. Better Auth uses the `auth` schema |
| `BETTER_AUTH_SECRET` | Runtime | Encrypts the signing keys and signs cookies. Generate with `openssl rand -base64 32`. Changing it invalidates sessions and stored signing keys |
| `BETTER_AUTH_URL` | Runtime | Public origin of the web app. Also the `iss` claim of API tokens |
| `API_JWT_AUDIENCE` | Runtime | `aud` claim of API tokens. Default `starter-api` |
| `SMTP_URL` | Runtime | `smtp://` or `smtps://` URL of the mail server. Mailpit locally: `smtp://localhost:10025` |
| `MAIL_FROM` | Runtime | From header, `Name <address>` or a bare address |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Runtime | `true` or `false` (default). No session before the address is confirmed. Recommended in production |
| `AUTH_IP_HEADER` | Runtime | Optional. Header the auth rate limiter reads the client address from. See [Authentication](authentication.md#rate-limiting-and-the-client-address) |
| `AUTH_TRUSTED_PROXIES` | Runtime | Optional. Comma-separated IPs or CIDRs of the proxies to skip in a forwarded chain |
| `API_INTERNAL_URL` | **Build time** | Origin of the Go API for the rewrite. `next build` and `next typegen` fail without it |

`SMTP_URL`, `MAIL_FROM` and the first three variables are required: the app refuses to start, and `next build` fails, without them (the image build and CI use placeholders). Local values live in `apps/web/.env.local` (git-ignored). None of these variables is exposed to the browser; there are no `NEXT_PUBLIC_` variables.

## Next.js settings

`next.config.ts`:

- `reactCompiler: true`. Do not add `useMemo` or `useCallback` by default.
- `typedRoutes: true`. `href` values and redirects are type-checked; `pnpm typecheck` runs `next typegen` first.
- `output: "standalone"` with `outputFileTracingRoot` set to the repository root, for the container image.
- `poweredByHeader: false`.
- Security headers on every response: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`. There is no Content-Security-Policy yet.

## Scripts

Run with `pnpm --filter web <script>` from the repository root.

| Script | Does |
| --- | --- |
| `dev` | `next dev` on port 3100 |
| `build` | Production build |
| `start:standalone` | Serves the build with the standalone server, the supported way for `output: "standalone"` and what the image and CI run. See [Running the production build](#running-the-production-build) |
| `start` | `next start`. Works, but Next.js warns that it is not supported with standalone output; prefer `start:standalone` |
| `lint` | `oxlint --deny-warnings` |
| `format`, `format:check` | `oxfmt` |
| `typecheck` | `next typegen && tsc --noEmit` |
| `test`, `test:watch` | Vitest unit tests (`src/**/*.test.ts`) |
| `test:e2e` | Playwright specs in `e2e/`. Needs the whole stack running |
| `api:generate` | Regenerate `src/lib/api/gen` from `openapi/openapi.yaml` |
| `db:migrate` | Create or update Better Auth's tables |

## Running the production build

```sh
pnpm --filter web build
pnpm --filter web start:standalone                         # http://localhost:3100
PORT=3101 HOST=127.0.0.1 pnpm --filter web start:standalone
```

`scripts/start-standalone.sh` copies `.next/static` and `public` next to the standalone server (the bundle leaves them out, as the Dockerfile's `COPY` lines show) and starts `node .next/standalone/apps/web/server.js`. Two things it takes care of, both checked against a real run:

- The standalone server changes into its own directory and does **not** read `apps/web/.env.local`; started bare it fails with `Missing environment variable DATABASE_URL`. The script loads the file with Node's `--env-file-if-exists`, so variables already set in the environment win, and values a shell could not source (`MAIL_FROM` has spaces and angle brackets) are read correctly. In a container there is no file and the platform sets the variables.
- The listen address is `HOST`, not `HOSTNAME`, which shells and containers set to the machine name.

`API_INTERNAL_URL` is read at build time (the rewrite is baked in), so build with the API address you will run against.

## Idempotent creates

The API runs a create that carries an `Idempotency-Key` once and replays its response to retries ([Backend](backend.md#idempotency)), so a double submit or a retry after a lost response cannot add a second row. `src/lib/api/idempotency.ts` produces the keys for a form:

```tsx
const [keyFor] = useState(createIdempotencyKeys);
create.mutate({ body, headers: { "Idempotency-Key": keyFor(body) } });
```

A key names one request, not one form: the API answers 422 when a key comes back with a different body. So `keyFor` returns the same key for the same body (a retry) and a new one as soon as the user edits something. Create the generator once per mounted form, as `clients/client-form-dialog.tsx` does. Updates and deletes need no key: `PUT` and `DELETE` are already idempotent.

## Error reporting

No vendor SDK ships with the app. `src/lib/error-reporter.ts` exports `reportError(error, context)`, and its `sink` function, which does nothing by default, is the one place to plug a service in: replace its body (the file shows the shape, with dynamic imports so a server SDK stays out of the browser bundle and a browser SDK out of the first paint). Everything below already calls it:

| Where | Catches |
| --- | --- |
| `src/instrumentation.ts`, `onRequestError` | Server-side errors: Server Components, route handlers, the proxy. Next.js has logged them already. Awaited, as the Next.js docs require |
| `src/app/(app)/error.tsx` | A render error in a signed-in page. The shell stays; the user gets a retry and the error's `digest` as a reference that matches the server log |
| `src/app/global-error.tsx` | A render error nothing closer caught, including the root layout. Brings its own `<html>`, imports `globals.css`, and uses no providers or fonts |
| `src/instrumentation-client.ts` | Uncaught browser errors and unhandled promise rejections |
| `src/components/providers.tsx` | Failed queries and mutations that the user did not cause: a 5xx, or no answer at all. A 4xx (validation, a conflict, an expired token, the rate limit) is normal flow, shown by the screen that made the call, and is not reported |

What may never be sent, and how the module enforces it:

- The context is rebuilt from an allow-list (`safeContext`): `source`, `route`, `method`, `status`, `digest`, `operation`, `routeType`. Anything else a caller passes, such as headers, a query key or a request, is dropped. Strings are capped at 200 characters.
- `route` loses its query string and fragment. A password-reset link carries its token there, and `onRequestError` receives the full path.
- Of a request, only the method and path are used. Headers hold the session cookie and the API token.
- A failed API call is reduced to `API request failed with status N` (`apiErrorForReport`): a problem-details body can quote what the user typed, including an email address. Only the operation name is taken from the query key, for the same reason.
- `reportError` never throws.

A vendor implementation must keep to this: no tokens, cookies, emails, request bodies or query strings, and no session replay or automatic breadcrumbs that capture form input on the auth pages.

## Tracing

`src/instrumentation.ts` registers OpenTelemetry through `@vercel/otel`, but only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or the traces-specific variable) is set, the same switch the Go API uses. Next.js forwards `traceparent` through the `/api/v1` rewrite, so a page request, its API calls and their SQL queries land in one trace. It is a runtime variable: nothing about tracing is baked into the build. See [Backend](backend.md#observability) for a local Jaeger command.

## Testing

Two layers, split by what they need to run.

**Unit tests (Vitest).** Files named `*.test.ts` next to the module they test, run in Node with no browser, database or network. `pnpm --filter web test` (also part of `make test` through Turborepo). They cover pure modules:

- `src/lib/api/token.test.ts`: the in-memory API token cache: one fetch is reused, concurrent callers share a request, the token is refreshed a minute before it expires, and `clearApiToken()` discards a request that was still in flight so a previous user's token is never written back.
- `src/lib/env.test.ts`: environment validation, including URLs without an `http(s)` scheme.
- `src/lib/api/problem.test.ts`: mapping problem-details errors onto form fields.
- `src/app/(app)/clients/schema.test.ts`: the client form schema against the API limits, and the request body mapping (blank optional fields are omitted).
- `src/lib/mailer.test.ts`: the mail failure path. `sendMail` never throws and logs only the kind and the error code when the server is unreachable (mocked, and once for real against a closed local port) or rejects the recipient; the recipient, the link and the body never reach the console. The password-reset and verification hooks in `auth.ts` return the same way, without waiting for SMTP, whether the send succeeds or fails. Delivery through a real provider cannot be tested without credentials and is not.
- `src/lib/error-reporter.test.ts`: the context allow-list, query strings stripped from routes, which API failures count as unexpected, and that a problem-details body is reduced to its status.

`authClient` is replaced with `vi.mock("@/lib/auth-client")`. Module state (the token cache, `env`) is reset per test with `clearApiToken()` or `vi.resetModules()`. There is no jsdom or Testing Library yet; add them together with the first component test. Async Server Components cannot be unit tested with Vitest, so pages are covered end to end.

**End-to-end tests (Playwright).** `e2e/*.spec.ts`, Chromium only, against the real stack: Postgres, the Go API and the web app. Nothing is started by Playwright:

```sh
make migrate && make dev            # terminal 1
pnpm --filter web test:e2e          # terminal 2
```

CI runs the same specs against the production build served by `start:standalone`.

`e2e/auth.spec.ts` signs up a new user with a unique email each run, checks that the dashboard shows the identity returned by `GET /api/v1/me` (session cookie, API token, rewrite, JWKS verification in Go), signs out and checks the dashboard is closed again. It also covers a failed sign-in and the stale-cookie case: a garbage `better-auth.session_token` cookie must end on the sign-in form rather than in a redirect loop. The specs leave their users in the local database.

`e2e/clients.spec.ts` drives the reference feature: empty state, create, a duplicate tax ID shown as a field error (the API's 409), search, edit, delete, and a second user who must not see the first user's clients.

`e2e/clients-pagination.spec.ts` proves cursor pagination in the UI: it creates 25 clients through the API as the signed-in user (`createClients` in `e2e/helpers.ts`: a token from `/api/auth/token` with the page's cookies, then sequential `POST /api/v1/clients` so the time-ordered IDs follow the names), then checks that the list shows the 20 newest, that "Load more" appends the remaining 5 newest first with no repeats, and that the control disappears on the last page.

`e2e/email.spec.ts` reads the emails the app sent from Mailpit's HTTP API (`e2e/mailbox.ts`, `E2E_MAILPIT_URL`, default `http://localhost:18025`) and follows their links: verification clears the banner, the resend action sends a second message, a forgotten password is replaced (the old one stops working, the link works once), an unknown address gets the same answer and no email, and broken links explain themselves.

`e2e/verification-required.spec.ts` covers the other mode and is skipped by default, because the rest of the suite needs sign-up to give a session. Run it alone against a server started with `AUTH_REQUIRE_EMAIL_VERIFICATION=true`: `E2E_REQUIRE_EMAIL_VERIFICATION=true pnpm --filter web test:e2e verification-required`.

`e2e/helpers.ts` exports the `test` to import in every spec, plus `signUp` and `signOut`. Its `test` sends a different `X-Forwarded-For` per test: in production mode (`start:standalone`, CI) Better Auth limits sign-up and sign-in to three requests per ten seconds per IP, which a parallel suite would hit immediately. The rate limit stays enabled; each test is simply a different visitor. That this works is also the reason production must set `AUTH_IP_HEADER` or `AUTH_TRUSTED_PROXIES`.

First run on a machine: `pnpm --filter web exec playwright install chromium`. Set `E2E_BASE_URL` to test another origin. Use role and label selectors, not CSS classes. The script is deliberately not called `test`, so `make test` never needs a database.

## Linting and formatting

Oxlint (`.oxlintrc.json`) with the `typescript`, `react`, `nextjs`, `jsx-a11y`, `import`, `promise`, `unicorn` and `oxc` plugins. Correctness rules are errors; suspicious and performance rules are warnings, and warnings fail the lint script. oxfmt (`.oxfmtrc.json`) formats at 100 columns. Both ignore the generated client.

Biome, ESLint and Prettier are not used in this project.

## UI

### Design language

shadcn/ui (Radix base, `components.json`) on Tailwind 4. There is one set of tokens, shadcn's, defined in `src/app/globals.css`: paper background, ink text, a deep green `primary` for actions and red ink `destructive`. Dark values sit under `prefers-color-scheme: dark` and the `dark:` variant is mapped to the same media query, so the app follows the system and there is no theme toggle or `.dark` class. Type is IBM Plex Sans (Plex Mono for identifiers); use `tabular-nums` wherever figures line up in a column. Corners are small (`--radius: 0.375rem`). The double red margin rule on the navigation edge (`.margin-rule`) is the one decorative element; don't repeat it.

Write interface copy in sentence case, name actions by what they do ("Add client", "Save changes") and keep the same word in the toast that follows ("Client added", "Changes saved").

### Adding a shadcn component

```sh
cd apps/web
pnpm dlx shadcn@latest add <component>
```

Run it from `apps/web`, never with `npm`/`npx` at the repo root. Add only what you use. Components land in `src/components/ui/`, which Oxlint ignores (oxfmt still formats it). The toaster (`ui/sonner.tsx`) was edited to follow the system theme instead of `next-themes`; keep that if you re-add it.

### States

Every request-backed view renders one of `LoadingState`, `ErrorState` (message plus "Try again") or, when the data is empty, `EmptyState` (what is missing plus the action that fills it) from `src/components/states.tsx`. Get the message for an error with `describeProblem(error, fallback)`.

### Forms

One convention: react-hook-form with a zod schema (`zodResolver`) and shadcn's `Field` components, each input wrapped in a `Controller`:

```tsx
<Controller
  name="name"
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor="client-name">Name</FieldLabel>
      <Input {...field} id="client-name" aria-invalid={fieldState.invalid} />
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
    </Field>
  )}
/>
```

- The form's zod schema is its own (inputs hold `""` for a blank optional field, and the messages are written for people), but it **reads its limits from the generated contract schema** (`zClientFields.shape.name.maxLength`), so they cannot drift from the Go API. `schema.test.ts` checks that every body the form can produce parses with the contract schema, and that one character past each limit is rejected. The API remains the authority.
- Use `Controller` (or `useWatch`), not `form.watch()`: the React Compiler cannot memoise components that call `watch`.
- Map what the form holds to the request body in a pure function next to the schema (`toBody` in `clients/schema.ts`) and test it. Blank optional fields are omitted: the API rejects `""` for a field with a format such as `email`.
- When the API rejects the request, `mapProblemToForm(error, { fields, conflictField })` splits the problem into `fieldErrors` (from `errors[].location`, e.g. `body.tax_id`; a 409 goes to `conflictField`) and a `formError` for everything else. Set the first with `form.setError(name, { type: "server", message })` and show the second in an `Alert` above the submit button. See `clients/client-form-dialog.tsx`.
- No `finally` in components (the React Compiler skips them). With `useMutation` the pending flag comes from the mutation; hand-written handlers reset their flag on every failure path.

### Lists and cache updates

Lists use the generated `...InfiniteOptions` with `useInfiniteQuery`, `getNextPageParam: (page) => page.next_cursor ?? undefined` and a "Load more" button. Search input is debounced with `useDebouncedValue` and becomes part of the query key, with `placeholderData: keepPreviousData` so rows stay while the next term loads.

After a mutation, invalidate rather than patch the cache (`invalidateClientLists` in `clients/queries.ts`): every cached list, one per search term, is refetched, so ordering, matches and cursors always come from the server.

### Adding a signed-in page

1. Create `src/app/(app)/<section>/page.tsx` as a Server Component and start it with `await requireSession()`. This is the access check. The `(app)` layout also calls it, but only to fill the user menu: a layout is not re-rendered on client navigation, so it cannot guard a page.
2. Add the path to `matcher` in `src/proxy.ts` (`"/<section>/:path*"`). The proxy only sends visitors without a session cookie to `/sign-in`; it never redirects into the app, which is what keeps a stale cookie from looping.
3. Add the link to `NAVIGATION` in `src/components/app-shell.tsx`.
4. Put interactive parts in a client component that talks to the Go API through the generated TanStack Query options. No Server Actions.
5. Cover it in `e2e/`, including that a signed-out visitor ends on `/sign-in`.
