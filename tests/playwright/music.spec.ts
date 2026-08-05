// Playwright 真瀏覽器閘門：雙態程序化音樂系統（M2 第三階段，見 src/audio/music.ts）。
// chromium 專屬（playwright.config.ts 的 webkit／firefox project 只跑 smoke.spec.ts，本檔
// 不受影響）。用 window.__p96.debug.musicState() 讀取邏輯狀態：點擊進入後應為 explore；
// teleportPlayer 把玩家送進區域 B 敵人偵測範圍讓敵人 aggro（chase／attack）後應立即轉
// combat；2026-08-05 起（Lin 實玩回饋）combat 為單向：clearArea 清空敵人後仍持續 combat
// 不退回 explore，僅重新開始或回主選單重進才重置。
import { test, expect } from "@playwright/test";
// window.__p96 型別宣告見 src/types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效）。

test("音樂雙態：aggro 轉 combat 後單向持續，敵人清空不退回", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");
  await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });
  await page.locator("#p96-start-overlay").click();
  await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });

  // 點擊進入後（explore 起始層），出生點附近無敵人 aggro：musicState 應為 explore。
  expect(await page.evaluate(() => window.__p96!.debug.musicState())).toBe("explore");

  // 讓區域 B 敵人 aggro：teleport 到偵測範圍內（沿用 combat.spec.ts 同一組座標），
  // 給狀態機一點時間走過 idle→detect→chase（chase／attack／retreat／hurt 皆視為戰鬥態）。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 16, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.musicState() === "combat", undefined, { timeout: 3_000 });

  // 清空區域 B：combat 單向持續——立即仍是 combat，且等超過原滯後秒數（4 秒）後依然是 combat。
  await page.evaluate(() => window.__p96!.debug.clearArea("B"));
  expect(await page.evaluate(() => window.__p96!.debug.musicState())).toBe("combat");
  await page.waitForTimeout(4_000);
  expect(await page.evaluate(() => window.__p96!.debug.musicState())).toBe("combat");

  // 重新開始應重置回 explore（resetToExplore：combat 單向化後，新局不得殘留上一局的戰鬥層）。
  await page.evaluate(() => window.__p96!.debug.setState("paused"));
  await page.locator('[data-role="pause-restart"]').click();
  await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });
  expect(await page.evaluate(() => window.__p96!.debug.musicState())).toBe("explore");

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});
