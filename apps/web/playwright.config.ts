import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real stack: Postgres, the Go API and this app.
// Nothing is started from here. Run `make dev` (after `make migrate`) first;
// in CI the workflow starts the stack before calling `pnpm --filter web test:e2e`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
