import { expect, test, newUser, signOut, signUp } from "./helpers";

// Better Auth's session cookie in this app (default prefix, plain http locally).
const SESSION_COOKIE = "better-auth.session_token";

test("sign up, read identity from the Go API, sign out", async ({ page }) => {
  const user = newUser();

  await signUp(page, user);

  // The card is filled from GET /api/v1/me, so this proves the whole chain:
  // session cookie -> short-lived JWT -> Next.js rewrite -> Go API -> JWKS check.
  const identity = page.getByRole("region", { name: "Your identity, as seen by the API" });
  await expect(identity.getByText(user.email)).toBeVisible();
  await expect(identity.getByText(user.name)).toBeVisible();

  await signOut(page);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // The session is gone: the dashboard is closed again.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
});

test("a signed-in user is sent from the sign-in page to the dashboard", async ({ page }) => {
  await signUp(page);

  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("wrong password shows an error and keeps the form usable", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

// Regression: the proxy used to send any request with a session cookie from
// /sign-in to /dashboard while the dashboard sent invalid sessions back, so a
// stale cookie looped until ERR_TOO_MANY_REDIRECTS.
test("a stale session cookie ends on the sign-in form, not in a redirect loop", async ({
  context,
  page,
  baseURL,
}) => {
  await context.addCookies([
    { name: SESSION_COOKIE, value: "stale.garbage", url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);

  const response = await page.goto("/dashboard");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeEditable();

  // Same for the home page, which redirects on the session too.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});
