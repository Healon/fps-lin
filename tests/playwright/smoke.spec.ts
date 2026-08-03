// Playwright 真瀏覽器閘門：載入無 console error／pageerror、frames 前進、levelHash 與 golden
// 一致、點擊後 overlay 隱藏。對應 PLAN §8.1「真瀏覽器閘門」與 M0 AC。
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_LEVEL_HASH = readFileSync(path.join(here, "..", "golden", "level-hash.txt"), "utf8").trim();

declare global {
  interface Window {
    __p96?: {
      ready: boolean;
      frames: number;
      levelHash: string;
    };
  }
}

test("M0 smoke：載入、無錯誤、frames 前進、levelHash 正確、點擊後 overlay 隱藏", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  await page.goto("/");

  // canvas 存在且為滿版
  await expect(page.locator("#glcanvas")).toBeVisible();

  // 等待 boot 完成
  await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });

  // levelHash 與 golden 一致（純 CPU 決定性資料）
  const levelHash = await page.evaluate(() => window.__p96?.levelHash);
  expect(levelHash).toBe(GOLDEN_LEVEL_HASH);

  // frames 前進：不需使用者手勢即可運行（main.ts 設計為不等點擊就啟動主迴圈）
  const framesBefore = await page.evaluate(() => window.__p96?.frames ?? 0);
  await page.waitForTimeout(600);
  const framesAfter = await page.evaluate(() => window.__p96?.frames ?? 0);
  expect(framesAfter).toBeGreaterThan(framesBefore);

  // 點擊後 overlay 隱藏。註：實際接收點擊的是覆蓋全螢幕的 overlay 本身（其 z-index 高於
  // canvas），而非 canvas 元素本身；headless 環境下 Pointer Lock API 多半無法真正取得鎖，
  // 因此本測試只斷言 overlay 隱藏，不斷言 document.pointerLockElement 是否成功鎖定。
  const overlay = page.locator("#p96-start-overlay");
  await expect(overlay).toBeVisible();
  await overlay.click();
  await expect(overlay).toBeHidden();

  // 全程無 console error 與 pageerror
  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});
