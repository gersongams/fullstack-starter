---
name: web-auth-session
description: Guardrails for session, redirect and token code in the Next.js app (apps/web) with Better Auth. Use this whenever you touch apps/web/src/proxy.ts, any `redirect()` / `router.replace()` tied to being signed in or out, the sign-in / sign-up / sign-out UI, authClient calls, or the API token cache in apps/web/src/lib/api/token.ts — and whenever you add a new protected page, a new async button handler that talks to auth, anything that redirects to a URL taken from a query parameter (`next`, `callbackURL`, `redirectTo`), an email the app sends (verification, password reset, invitations), or a change to Better Auth's rate limit or IP settings. Also use it when reviewing such changes, even if the user only says "add a page" or "tweak the login flow".
---

# Web auth & session guardrails

These rules come from real bugs found in review of this repo. Each one looks
harmless in the happy path and only breaks when a session is stale, a request
fails, or two things race. Read `apps/web/AGENTS.md` and `docs/` (auth flow)
first; this skill is the list of traps on top of that.

## 1. A session cookie is a hint, not a session

The proxy can only see that a cookie *exists*. It cannot know the session is
valid: it may have expired, been revoked, belong to a wiped database, or be
signed with an old `BETTER_AUTH_SECRET`.

- Use cookie presence only for the cheap, safe direction: **no cookie →
  send to /sign-in**. That can never loop, because /sign-in doesn't require a cookie.
- Never use cookie presence for the opposite direction (**cookie → send away
  from /sign-in**). Only code that has actually validated the session
  (`getSession` on the server) may redirect a user *into* the app.

Why: if the proxy says "cookie, go to /dashboard" and the page says "invalid
session, go to /sign-in", a stale cookie bounces forever
(`ERR_TOO_MANY_REDIRECTS`). A server component cannot delete the cookie, so
the user is locked out until they clear cookies by hand.

**Before adding any redirect, write down the pair.** For the new redirect
A → B, find every redirect B → A and check that the two conditions can never
both be true for the same request. Test mentally with these four states:
no cookie, valid session, *stale/garbage cookie*, and auth backend down.

## 2. Anything cached per user must survive a sign-out race

Module-level caches (the API JWT in `lib/api/token.ts`, anything similar you
add) outlive the user who filled them. Clearing the variable is not enough if
a fetch is still in flight — when it resolves it writes the old user's value
back, and its cleanup can clobber a newer request.

- Keep a generation counter (or equivalent). Bump it in the clear function.
- A fetch captures the generation when it starts and, on completion, only
  writes the cache / resets `inFlight` if the generation is unchanged.
- Call the clear function on sign-out *and* on sign-in/sign-up, and clear the
  TanStack Query cache with it, so user A's data and token never reach user B.

## 3. Async handlers: check the result, always release the UI

Better Auth client calls (`signIn`, `signUp`, `signOut`, …) report failure two
ways: they can **return `{ error }`** or **reject**. Handle both.

```tsx
setError(undefined);
setPending(true);
try {
  const { error } = await authClient.signOut();
  if (error) {
    setError(/* user-facing message */);
    setPending(false);
    return;
  }
} catch {
  setError(/* user-facing message */);
  setPending(false);
  return;
}
clearApiToken();            // only after success
router.replace("/sign-in"); // only after success; stay pending while navigating
```

- No state clearing or navigation on failure — the user is still signed in, and
  navigating would just bounce them back with a dead button.
- Reset `pending` on **every** failure path. Don't reach for `finally` here:
  the React Compiler (`reactCompiler: true` in `next.config.ts`) skips
  components that contain a `finally` clause, and `finally` would also
  re-enable the button while a successful navigation is still in progress.
- Show the failure to the user with the app's existing error UI (the
  `role="alert"` message used by `components/auth-form.tsx` and
  `components/user-menu.tsx`); don't log tokens, emails or response bodies.

## 4. Don't validate sessions in the proxy

The proxy runs on every matched request including prefetches, and the Next.js
docs bundled with this version say not to do database/session lookups there.
Keep it to the optimistic no-cookie guard for the signed-in sections listed in
its `matcher`; real checks live on the server, through `src/lib/session.ts`:

- Every page under `src/app/(app)/` starts with `await requireSession()`, which
  redirects out when the session is invalid.
- `/`, `/sign-in`, `/sign-up` and `/forgot-password` use `getSession()` and redirect in when it is valid.
- Pages an emailed link lands on (`/reset-password`, `/email-verified`) never redirect. They report on the token in the URL and must work signed in or out, so they cannot join a loop.
- The `(app)` layout also calls `requireSession()`, but only to fill the user
  menu. A layout is not re-rendered on client navigation, so it is never the
  guard: a new page without its own `requireSession()` is unprotected.

A new protected route needs both: its own `requireSession()` and its path in
the proxy `matcher`.

## 5. A redirect target from the URL is attacker input

`/sign-in?next=...` is a link anyone can craft and send to a victim. Used
as is, it makes the real sign-in page forward to a phishing site after a real
sign-in, which is the most convincing phishing link there is.

- The only way a query parameter becomes a redirect is `safeRedirectPath` in
  `src/lib/redirect.ts`: same-origin paths only. It rejects absolute and
  protocol-relative URLs, backslashes (browsers read `/\evil.example` as
  `//evil.example`), control characters (the URL parser strips a tab, turning
  `/\t/evil` into `//evil`), `/api`, and the auth pages themselves.
- That last group matters for rule 1: `/sign-in?next=/sign-in` with a valid
  session is a redirect loop. A new public auth page goes into
  `PUBLIC_AUTH_PATHS`, with a test.
- Validate on the server page, pass the clean value down. Never
  `router.replace(searchParams.get("next"))` in a client component.
- On sign-in, don't pass `callbackURL` to `authClient.signIn.email`: the client
  treats it as "navigate there on success" and it overrides `next`.
- The server decides where emailed links land (`verificationLink` in
  `lib/auth.ts`); client-supplied `callbackURL`s are not relied on.

## 6. Emails must not reveal who has an account

- Every answer about an address is the same whether or not it has an account:
  the forgot-password confirmation, the resend action, and sign-up when
  `AUTH_REQUIRE_EMAIL_VERIFICATION=true`. Don't add a friendlier "no such
  account" message.
- Send after the response (`runAfterResponse` in `lib/auth.ts`, built on
  `after()`). Awaiting the SMTP call makes "known address" measurably slower
  than "unknown address", which leaks the same fact through timing.
- `sendMail` never throws and logs only the kind of message and the error code.
  Recipients, links and bodies are never logged: a reset link in a log file is
  an account takeover waiting for anyone who can read logs.
- Token-bearing pages set `referrer: "no-referrer"`.

## 7. The rate limit is keyed on a header

Better Auth reads the client address from `X-Forwarded-For` by default, which
any client that reaches the app directly can set, so rotating it buys a fresh
sign-in budget each time (`e2e/helpers.ts` does exactly that on purpose).
Production sets `AUTH_IP_HEADER` to the header its proxy overwrites and/or
`AUTH_TRUSTED_PROXIES`. Don't "fix" a rate-limited test by disabling the
limit or raising it; give the test its own address. See
`docs/authentication.md`, "Rate limiting and the client address".

## Error reports carry no secrets

`src/lib/error-reporter.ts` is the only path to an error-tracking service.
Its context is rebuilt from an allow-list (`safeContext`), and routes lose
their query string, because reset and verification tokens live there. When
adding a field, add it to the allow-list with a test; never pass headers,
cookies, request bodies, emails or a full URL.

## Checklist before you finish

- [ ] Every new/changed redirect checked against its opposite for the stale-cookie case.
- [ ] No decision "user is signed in" made from cookie presence alone.
- [ ] Every new page under `(app)` calls `requireSession()` itself and its path is in the proxy `matcher`.
- [ ] Per-user caches are cleared on sign-in and sign-out, and late in-flight results are discarded.
- [ ] Every awaited auth/API call in a handler handles `{ error }` and rejection, and every failure path resets loading state (no `finally` in components).
- [ ] No redirect to a value from the URL except through `safeRedirectPath`; new public auth pages added to `PUBLIC_AUTH_PATHS`.
- [ ] Answers and timing are identical for known and unknown addresses; nothing about a recipient is logged.
- [ ] `docs/` auth flow updated if behaviour changed (CLAUDE.md requires it).
