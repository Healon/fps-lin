import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8331",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://localhost:8331",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
