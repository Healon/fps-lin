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
      // 完整套件維持 chromium 專屬以控時間（PLAN §8.1 真瀏覽器閘門；本次派工規格）。
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // 跨瀏覽器相容（本次派工規格）：webkit／firefox 僅跑 smoke，驗載入、零 console error、
      // frames 前進、levelHash 與 golden 一致，不重跑戰鬥／關卡流程等完整劇本以控時間。
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: /smoke\.spec\.ts$/,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: /smoke\.spec\.ts$/,
    },
  ],
});
