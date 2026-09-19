import { expect, test, newUser } from "./helpers";
import { linkFromEmail } from "./mailbox";

// Only meaningful against a server started with AUTH_REQUIRE_EMAIL_VERIFICATION=true,
// where the other specs cannot run (their sign-up helper expects a session). Run it alone:
//   E2E_REQUIRE_EMAIL_VERIFICATION=true pnpm --filter web test:e2e verification-required
test.skip(
  process.env.E2E_REQUIRE_EMAIL_VERIFICATION !== "true",
  "needs a server with AUTH_REQUIRE_EMAIL_VERIFICATION=true",
);

test("nobody gets a session before confirming their email", async ({ page, request }) => {
  const user = newUser();

  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  // No session yet.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);

  // The right password is not enough either, and the way out is offered.
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send the email again" })).toBeVisible();

  const link = await linkFromEmail(request, user.email, /confirm your email/i);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();

  // Confirming signs the visitor in.
  await page.getByRole("link", { name: "Continue to the dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("region", { name: "Email verification" })).toHaveCount(0);
});

test("signing up with a registered address answers like a new one", async ({ page }) => {
  const user = newUser();

  async function signUpAs(name: string) {
    await page.goto("/sign-up");
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  }

  await signUpAs(user.name);
  await signUpAs("Someone Else");
});
