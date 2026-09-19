import { expect, test, newUser, signOut, signUp } from "./helpers";
import { countEmails, linkFromEmail } from "./mailbox";

// These specs need Mailpit (compose.yaml, started by `make db-up`) and the app
// configured with SMTP_URL pointing at it, which .env.example does.

test("the verification email confirms the address and clears the banner", async ({
  page,
  request,
}) => {
  const user = await signUp(page);

  const banner = page.getByRole("region", { name: "Email verification" });
  await expect(banner).toContainText(user.email);

  const link = await linkFromEmail(request, user.email, /confirm your email/i);
  await page.goto(link);
  await expect(page).toHaveURL(/\/email-verified$/);
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();

  await page.getByRole("link", { name: "Continue to the dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("a verification link that was tampered with explains itself", async ({ page }) => {
  await page.goto("/api/auth/verify-email?token=not.a.token&callbackURL=/email-verified");
  await expect(page).toHaveURL(/\/email-verified\?error=/);
  await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
});

test("the banner can send the verification email again", async ({ page, request }) => {
  const user = await signUp(page);
  await linkFromEmail(request, user.email, /confirm your email/i);

  const banner = page.getByRole("region", { name: "Email verification" });
  await banner.getByRole("button", { name: "Send the email again" }).click();
  await expect(banner.getByText("A new link is on its way")).toBeVisible();

  await expect
    .poll(() => countEmails(request, user.email, /confirm your email/i), { timeout: 15_000 })
    .toBe(2);
});

test("a forgotten password is replaced through the emailed link", async ({ page, request }) => {
  const user = await signUp(page);
  await signOut(page);

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If an account exists for that address")).toBeVisible();

  const link = await linkFromEmail(request, user.email, /reset your/i);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?token=/);

  const newPassword = "a-brand-new-password";
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Repeat the new password").fill("something-else-entirely");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("The passwords do not match")).toBeVisible();

  await page.getByLabel("Repeat the new password").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/\/sign-in\?reset=done$/);
  await expect(page.getByText("Password changed. Sign in with the new one.")).toBeVisible();

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // The link worked once.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
});

test("asking to reset an unknown address looks the same and sends nothing", async ({
  page,
  request,
}) => {
  const stranger = newUser();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(stranger.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If an account exists for that address")).toBeVisible();

  // Long enough for a message to arrive if one had been sent.
  await page.waitForTimeout(2_000);
  expect(await countEmails(request, stranger.email, /./)).toBe(0);
});

test("a reset link without a valid token explains itself", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
});
