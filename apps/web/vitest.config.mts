import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests only: pure modules under src/. Pages and async Server Components
// are covered by the Playwright specs in e2e/.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
