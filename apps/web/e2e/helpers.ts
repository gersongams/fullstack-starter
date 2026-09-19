import { test as base, expect, type Page } from "@playwright/test";

function randomOctet() {
  return 1 + Math.floor(Math.random() * 254);
}

/**
 * Every test is a different visitor. Better Auth rate-limits sign-up and
 * sign-in per IP when the app runs in production mode (`next start`, CI): three
 * requests per ten seconds, which a parallel suite exceeds at once. It reads the
 * IP from X-Forwarded-For, so each test sends its own. The limit itself stays on.
 */
export const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form.
  extraHTTPHeaders: async ({}, use) => {
    await use({ "X-Forwarded-For": `10.${randomOctet()}.${randomOctet()}.${randomOctet()}` });
  },
});

export { expect };

export function newUser() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: `E2E User ${id}`,
    email: `e2e-${id}@example.com`,
    password: "correct-horse-battery",
  };
}

/** Creates a fresh account and lands on the dashboard. */
export async function signUp(page: Page, user = newUser()) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return user;
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}

/**
 * Creates clients through the API as the signed-in user of `page`, the way the
 * browser does: a token from Better Auth (the page's cookies ride along), then
 * POST /api/v1/clients through the Next.js rewrite. One at a time, so the
 * time-ordered IDs follow the order of `names`.
 */
export async function createClients(page: Page, names: string[]) {
  const tokenResponse = await page.request.get("/api/auth/token");
  expect(tokenResponse.ok(), "GET /api/auth/token").toBe(true);
  const { token } = (await tokenResponse.json()) as { token: string };

  for (const name of names) {
    // oxlint-disable-next-line no-await-in-loop -- sequential on purpose: creation order is the list order.
    const created = await page.request.post("/api/v1/clients", {
      headers: { Authorization: `Bearer ${token}` },
      data: { name },
    });
    expect(created.status(), `POST /api/v1/clients (${name})`).toBe(201);
  }
}
