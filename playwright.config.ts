import { defineConfig } from "@playwright/test";

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 4,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
});
