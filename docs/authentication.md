# Authentication

There are two credentials, each with one job.

| Credential | Issued by | Stored | Lifetime | Used for |
| --- | --- | --- | --- | --- |
| **Session cookie** | Better Auth, on sign-in | httpOnly cookie; session row in `auth.session` | Better Auth default (days, renewed on use) | Proving to the web app who the user is |
| **API token** (JWT) | Better Auth JWT plugin, on request | Browser memory only | 15 minutes | Proving to the Go API who the user is |

The Go API never sees or accepts the session cookie. A request with a valid cookie but no token gets a 401.

## Sign-up and sign-in

Better Auth runs inside the Next.js app. `src/app/api/auth/[...all]/route.ts` exposes its endpoints under `/api/auth/*`, configured in `src/lib/auth.ts`:

- Email and password, minimum length 10 (`MIN_PASSWORD_LENGTH` in `src/lib/password.ts` and `src/lib/auth.ts` must agree).
- Email verification and password reset by email. See [Email flows](#email-flows).
- An explicit rate limit. See [Rate limiting](#rate-limiting-and-the-client-address).
- Tables in the `auth` Postgres schema (`user`, `session`, `account`, `verification`, `jwks`).
- The `jwt` plugin, with explicit issuer and audience.
- `nextCookies()` last in the plugin list, so server-side auth calls can set cookies.

The browser uses `authClient` from `src/lib/auth-client.ts` (`signUp.email`, `signIn.email`, `signOut`, `token`, `sendVerificationEmail`, `requestPasswordReset`, `resetPassword`).

## API tokens

`GET /api/auth/token` returns a JWT for the current session:

```
header:  { "alg": "EdDSA", "kid": "<key id>" }
payload: {
  "sub":   "<user id>",
  "email": "<email>",
  "name":  "<display name>",
  "iss":   "http://localhost:3100",   // BETTER_AUTH_URL
  "aud":   "starter-api",          // API_JWT_AUDIENCE
  "iat":   ...,
  "exp":   ...                        // iat + 15 minutes
}
```

`definePayload` limits the claims to `email` and `name`. By default Better Auth would copy the whole user record into the token.

The signing key pair is created by Better Auth on first use and stored in `auth.jwks`, with the private key encrypted using `BETTER_AUTH_SECRET`. Public keys are served at `/api/auth/jwks`.

### Token handling in the browser

`src/lib/api/token.ts`:

- Keeps the token in a module variable. It is never written to `localStorage`, `sessionStorage` or a readable cookie, so it does not survive a page reload and cannot be read from disk.
- Reuses the token until 60 seconds before its `exp`, then fetches a new one.
- Shares one in-flight request between concurrent callers, so ten parallel queries cause one token request.
- `clearApiToken()` is called on sign-out, together with clearing the TanStack Query cache.

The generated API client calls `getApiToken()` for every operation that declares the bearer security scheme (`src/lib/api/client-config.ts`).

## Verification in Go

`internal/auth/verifier.go` verifies each token:

1. Signature, against the key set from `AUTH_JWKS_URL`. The algorithm is inferred from the key type, so a token cannot choose a weaker algorithm.
2. `iss` equals `AUTH_ISSUER`.
3. `aud` contains `AUTH_AUDIENCE`.
4. `exp` and `nbf`, with 30 seconds of clock skew allowed.
5. `sub` is present.

Key handling:

- Keys are fetched lazily, so the API can start before the web app is reachable.
- The key set is cached for 15 minutes.
- If a signature cannot be verified, the keys are refetched once, which handles key rotation. The check is retried only when the refetch returned a different key set, so a bad token is never verified twice against the same keys. Refetches are limited to one per minute so bad tokens cannot be used to hammer the JWKS endpoint.
- The lock is never held during a fetch: concurrent requests share a single in-flight fetch.
- If the JWKS endpoint is down, the last known keys keep working. Failed fetches are retried at most every 10 seconds, so an outage costs one outbound request per backoff window rather than one per API request.
- With no keys at all (for example the API started before the web app), verification fails with `auth.ErrKeysUnavailable`.

`internal/auth/middleware.go` is a Huma middleware. It applies only to operations that declare `Security: auth.Required`, responds 401 with a problem-details body when the token is missing or invalid, and puts the user in the request context. When the token could not be checked because no signing keys are available, it responds 503 and logs at error level instead, so an auth outage is not mistaken for signed-out users. Protected operations list both statuses in `Errors`. Handlers read it with `auth.UserFrom(ctx)`.

The three values must match across the two apps:

| Go API | Web app | Local value |
| --- | --- | --- |
| `AUTH_ISSUER` | `BETTER_AUTH_URL` | `http://localhost:3100` |
| `AUTH_AUDIENCE` | `API_JWT_AUDIENCE` | `starter-api` |
| `AUTH_JWKS_URL` | `BETTER_AUTH_URL` + `/api/auth/jwks` | `http://localhost:3100/api/auth/jwks` |

## Email flows

### The mailer

`src/lib/mailer.ts` sends through any SMTP server with nodemailer, configured by `SMTP_URL` and `MAIL_FROM`. It is provider-neutral: every transactional email service offers an SMTP endpoint. In development `make db-up` also starts [Mailpit](https://mailpit.axllent.org), which catches every message and delivers none; read them at http://localhost:18025 (SMTP on `localhost:10025`; both bound to loopback, because the inbox holds reset links).

- Messages are built by pure functions in `src/lib/email-templates.ts` (a text part and a simple HTML part; the user's name and the link are escaped).
- Emails are sent **after the response** (`after()` from `next/server`). The response time must not depend on whether a message went out, or it would tell the caller whether an address has an account. On a long-running server (`next start`, the container image) this just works; on a serverless platform `after()` relies on the platform's `waitUntil`.
- `sendMail` never throws and logs only failures, as the kind of message and the SMTP error code. Recipients, links and bodies are never logged. A delivery failure is therefore invisible to the person at the keyboard: watch the logs for `mail failed`.

### Email verification

A verification email goes out on sign-up. `AUTH_REQUIRE_EMAIL_VERIFICATION` decides what an unverified account can do:

| | `false` (default, development) | `true` (recommended in production) |
| --- | --- | --- |
| After sign-up | Signed in straight away | No session. The form turns into "Check your inbox" with a resend button |
| Sign-in while unverified | Works | Refused (`EMAIL_NOT_VERIFIED`), a fresh link is emailed (`sendOnSignIn`), same "Check your inbox" state |
| Signing up with a registered address | "User already exists" error | Answered exactly like a new address, so sign-up cannot be used to find out who has an account |
| In the app | A banner asks to confirm the address, with a resend action | Not reachable unverified |

The link goes to `/api/auth/verify-email`, which checks the token and redirects to `/email-verified` (`?error=...` when the token is invalid or expired). The server sets that landing page for every verification link (`verificationLink` in `src/lib/auth.ts`), whatever `callbackURL` the caller sent. Confirming signs the visitor in (`autoSignInAfterVerification`). Links expire after one hour. They are signed tokens, not database rows, so a link can be opened again within that hour (it just confirms an already confirmed address) and a newer link does not cancel an older one.

With the default `false`, anyone can create an account for an address they do not own. That is acceptable for local development and demos; turn it on before real users arrive.

### Password reset

`/sign-in` links to `/forgot-password`. The form always answers "if an account exists for that address, a link is on its way": Better Auth answers a known and an unknown address identically, and the email is sent after the response, so neither the body nor the timing gives the answer away. Only the rate limit or a network failure shows an error.

The emailed link goes to `/api/auth/reset-password/<token>`, which redirects to `/reset-password?token=...`, or `?error=INVALID_TOKEN` when the token is unknown or older than one hour. The page has no session check on purpose: the link must work in any browser, and the token is what authorises the change. It sets `referrer: no-referrer` so the token does not leak in a `Referer` header. The form (`src/components/reset-password-form.tsx`) follows the app's form convention. The token is consumed on use, so the link works once.

`revokeSessionsOnPasswordReset: true` ends every session of the account when the password changes: a reset is what someone does after losing control of an account. The user then signs in with the new password. API tokens already issued stay valid until they expire (at most 15 minutes), like after sign-out.

### Rate limiting and the client address

`rateLimit` in `src/lib/auth.ts` is explicit: enabled when `NODE_ENV=production`, 100 requests per 10 seconds per client address and path. Better Auth adds stricter built-in rules on top: **3 per 10 seconds** for `/sign-in/*`, `/sign-up/*`, `/change-password` and `/change-email`, and **3 per 60 seconds** for `/request-password-reset` and `/send-verification-email`. Counters are in memory, per instance; set `storage: "database"` (or a secondary storage) when running several instances.

The limit is only as good as the address it is keyed on, and that address comes from a request header:

- By default Better Auth reads `X-Forwarded-For` and believes it only when it holds a single address. **A client that reaches the app directly can send any value**, so it can rotate the header and get a fresh budget each time. This is exactly what `e2e/helpers.ts` does to let a parallel test suite through. Verified by hand: five sign-in attempts with five different `X-Forwarded-For` values all reach the password check.
- A proxy that *appends* to `X-Forwarded-For` produces a chain of two or more addresses, which Better Auth refuses without `trustedProxies`; every request then shares one bucket per path (it logs a warning once). That fails safe but will lock users out under load.

So in production set one or both of:

| Variable | Set it to | When |
| --- | --- | --- |
| `AUTH_IP_HEADER` | The header your platform sets and **overwrites** on every request: `cf-connecting-ip` (Cloudflare), `x-vercel-forwarded-for` (Vercel), `x-real-ip` (your own nginx with `proxy_set_header X-Real-IP $remote_addr`) | There is a CDN or reverse proxy in front. Verified by hand: with `AUTH_IP_HEADER=x-real-ip`, rotating `X-Forwarded-For` no longer helps and the fourth attempt gets 429 |
| `AUTH_TRUSTED_PROXIES` | The addresses or CIDR ranges of your proxies, e.g. `10.0.0.0/24` | The platform only gives you an appended `X-Forwarded-For` chain. The chain is walked right to left, trusted hops are skipped, and the first other address is the client |

Both are only safe when the app is reachable **only** through that proxy. If the app's port is also open to the internet, a caller can set the trusted header itself. The Go API has the same concern and its own setting, `TRUSTED_PROXIES` ([Backend](backend.md#rate-limiting)).

### Redirect targets

The proxy sends a signed-out visitor to `/sign-in?next=<where they were going>`. `next` is attacker-controlled (anyone can craft the link), so `safeRedirectPath` in `src/lib/redirect.ts` accepts only a same-origin path: no absolute or protocol-relative URL, no backslashes or control characters, nothing under `/api`, and none of the auth pages, which would turn a valid session into a redirect loop. Anything else falls back to `/dashboard`. Better Auth applies its own origin check to the `callbackURL` and `redirectTo` values it receives.

### Production checklist

- `AUTH_REQUIRE_EMAIL_VERIFICATION=true`.
- `SMTP_URL` and `MAIL_FROM` point at a real provider, and the sending domain has SPF and DKIM set up, or the emails land in spam.
- `AUTH_IP_HEADER` and/or `AUTH_TRUSTED_PROXIES` match the proxy in front, and the app is not reachable around it.
- `BETTER_AUTH_URL` is the public `https://` origin: it is the base of every emailed link and makes cookies `Secure`.
- More than one instance: move the rate limit counters out of memory.
- Alert on `mail failed` in the web app's logs.

## Route protection in the web app

Three layers, from cheapest to authoritative:

1. **`src/proxy.ts`** redirects based only on whether a session cookie exists, and only in one direction: no cookie on a signed-in section (`/dashboard`, `/clients`; the matcher lists each one) goes to `/sign-in?next=...` (see [Redirect targets](#redirect-targets)). It does not validate the cookie and is not a security boundary. It deliberately does not send a cookie on `/sign-in` or `/sign-up` to `/dashboard`: a stale cookie (expired or revoked session, reset database, rotated `BETTER_AUTH_SECRET`) would then bounce between the proxy and the dashboard forever.
2. **Server Components** validate the session through `src/lib/session.ts`. Every page under `src/app/(app)/` starts with `requireSession()`, which redirects to `/sign-in` when there is no valid session; `/`, `/sign-in`, `/sign-up` and `/forgot-password` use `getSession()` and go into the app when there is one. `/reset-password` and `/email-verified` never redirect: they only report on the token in the URL, so they cannot take part in a loop. `getSession` is wrapped in React `cache`, so a request validates once however many components ask. The `(app)` layout also calls it, but only to fill the account menu: layouts are not re-rendered on client navigation, so a layout check alone would not protect a page. Every redirect into the app is decided by a validated session, never by cookie presence.
3. **The Go API** verifies the token on every request. This is the only layer that protects data.

## Security properties

- The session cookie is httpOnly, so page scripts cannot read it.
- The API token lives 15 minutes and only in memory. A stolen token expires quickly; a stolen session cookie can mint new ones until the session is revoked.
- Signing out deletes the session, so no new tokens can be issued. Tokens already issued stay valid until they expire (at most 15 minutes). If that window is ever too long, shorten `expirationTime` or add a revocation check in Go.
- The Go API should not be exposed publicly; only the web app needs to reach it.
- Tokens, emails and request bodies are never logged. Rejected tokens log the reason and the request ID only.

## Tests

`internal/httpapi/me_test.go` stands in for Better Auth with a local JWKS server and Ed25519 keys, and checks: valid token accepted; missing header, non-bearer header, malformed token, expired token, wrong audience and a token signed by another key all rejected with 401.

`internal/auth/verifier_test.go` covers the key cache: `ErrKeysUnavailable` and recovery after the backoff, stale keys served while the endpoint is down with rate-limited fetches, concurrent callers sharing one fetch, and no second verification without new keys. `internal/auth/middleware_test.go` checks the 401 and 503 mapping. `internal/config/config_test.go` covers `APP_ENV` and `PORT` validation.
