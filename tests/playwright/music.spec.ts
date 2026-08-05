// Playwright 真瀏覽器閘門：雙態程序化音樂系統（M2 第三階段，見 src/audio/music.ts）。
// chromium 專屬（playwright.config.ts 的 webkit／firefox project 只跑 smoke.spec.ts，本檔
// 不受影響）。用 window.__p96.debug.musicState() 讀取邏輯狀態：點擊進入後應為 explore；
// teleportPlayer 把玩家送進區域 B 敵人偵測範圍讓敵人 aggro（chase／attack）後應立即轉
// combat；clearArea 清空後滯後 3 秒（HYSTERESIS_SECONDS，見 audio/music.ts）才轉回 explore
// （驗證滯後本身，而非立即切回）。
import { test, expect } from "@playwright/test";
// window.__p96 型別宣告見 src/types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效）。

test("M2 第三階段：音樂雙態隨敵人 aggro 切換，含 3 秒滯後才回 explore", async ({ page }) => {
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

  // 清空區域 B：滯後尚未過，應仍是 combat；等待滯後（3 秒）過後才轉回 explore。
  await page.evaluate(() => window.__p96!.debug.clearArea("B"));
  expect(await page.evaluate(() => window.__p96!.debug.musicState())).toBe("combat");
  await page.waitForFunction(() => window.__p96!.debug.musicState() === "explore", undefined, { timeout: 5_000 });

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});
