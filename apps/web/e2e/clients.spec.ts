import { expect, test, signOut, signUp } from "./helpers";

test("a user manages their clients, and nobody else sees them", async ({ page }) => {
  await signUp(page);
  const taxId = `20${Date.now()}`;

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Clients" })
    .click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole("heading", { name: "No clients yet" })).toBeVisible();

  // Create.
  await page.getByRole("button", { name: "Add client" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Acme Holdings");
  await dialog.getByLabel("Email").fill("billing@acme.test");
  await dialog.getByLabel("Tax ID").fill(taxId);
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Client added")).toBeVisible();

  const acme = page.getByRole("row", { name: /Acme Holdings/ });
  await expect(acme).toBeVisible();
  await expect(acme.getByText(taxId)).toBeVisible();

  // A second client that tries to reuse the tax ID: the API's 409 lands on the field.
  await page.getByRole("button", { name: "Add client" }).click();
  await dialog.getByLabel("Name").fill("Birch & Sons");
  await dialog.getByLabel("Tax ID").fill(taxId);
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/tax id/i);
  await expect(dialog.getByLabel("Tax ID")).toHaveAttribute("aria-invalid", "true");

  // Fixing the field is enough to save; the optional email was left blank.
  await dialog.getByLabel("Tax ID").fill(`${taxId}-B`);
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: /Birch & Sons/ })).toBeVisible();

  // Search filters by name.
  await page.getByLabel("Search clients by name").fill("birch");
  await expect(page.getByRole("row", { name: /Birch & Sons/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Acme Holdings/ })).toBeHidden();

  await page.getByLabel("Search clients by name").fill("zzz-no-such-client");
  await expect(page.getByRole("heading", { name: /No client matches/ })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("row", { name: /Acme Holdings/ })).toBeVisible();

  // Edit.
  await page.getByRole("button", { name: "Edit Acme Holdings" }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("Acme Holdings");
  await dialog.getByLabel("Name").fill("Acme Group");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Changes saved")).toBeVisible();
  await expect(page.getByRole("row", { name: /Acme Group/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Acme Holdings/ })).toBeHidden();

  // Another user starts with an empty list.
  await signOut(page);
  await signUp(page);
  await page.goto("/clients");
  await expect(page.getByRole("heading", { name: "No clients yet" })).toBeVisible();
  await expect(page.getByText("Acme Group")).toBeHidden();
});

test("deleting the last client brings the empty state back", async ({ page }) => {
  await signUp(page);
  await page.goto("/clients");

  await page.getByRole("button", { name: "Add client" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Short-lived Ltd");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("row", { name: /Short-lived Ltd/ })).toBeVisible();

  await page.getByRole("button", { name: "Delete Short-lived Ltd" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("heading", { name: "Delete Short-lived Ltd?" })).toBeVisible();
  await confirm.getByRole("button", { name: "Delete client" }).click();

  await expect(confirm).toBeHidden();
  await expect(page.getByText("Client deleted")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No clients yet" })).toBeVisible();
});

test("a signed-out visitor is sent to sign in and then back to the clients page", async ({
  page,
}) => {
  const user = await signUp(page);
  await signOut(page);

  await page.goto("/clients?q=acme");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fclients%3Fq%3Dacme$/);

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/clients\?q=acme$/);
});

test("the next parameter cannot send a visitor to another site", async ({ page }) => {
  const user = await signUp(page);
  await signOut(page);

  await page.goto("/sign-in?next=https://evil.example/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Already signed in: the sign-in page redirects at once, and still not off-site.
  await page.goto("/sign-in?next=//evil.example");
  await expect(page).toHaveURL(/\/dashboard$/);
});
