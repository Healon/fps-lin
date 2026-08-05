// Playwright 真瀏覽器閘門：M3 第一階段（區域 D、射擊體、控制台 E 鍵互動）。
// 通關劇本延伸至區域 D 已併入 tests/playwright/m2-level.spec.ts 測試 (a)（同一份完整流程）；
// 本檔聚焦兩個 M3 專屬情境：射擊體會實際打傷玩家、E 鍵（真實輸入路徑，非 debug 後門）
// 可啟動控制台並解鎖 door-d。
import { test, expect } from "@playwright/test";
// window.__p96 型別宣告見 src/types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效）。

test("(a) 射擊體會打傷玩家：teleport 至區域 D 視線內站定，等待後 HP 應下降", async ({ page }) => {
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

  expect(await page.evaluate(() => window.__p96!.spittersAlive())).toBe(3);
  expect(await page.evaluate(() => window.__p96!.playerHp())).toBe(100);

  // 直接 teleport 到區域 D 中央（無需先開 door-c／door-d，teleportPlayer 略過移動與碰撞，
  // 射擊體的視線與距離判定只看目前位置，見 game/spitter.ts hasClearLineOfSight）。
  // 全程不按任何移動鍵，符合「站著不動」情境。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 55, y: 0, z: -10 }));

  await page.waitForFunction(() => (window.__p96?.playerHp() ?? 100) < 100, undefined, { timeout: 10_000 });
  const hpAfter = await page.evaluate(() => window.__p96!.playerHp());
  expect(hpAfter, `射擊體應已造成傷害，實際 HP=${hpAfter}`).toBeLessThan(100);

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});

test("(b) E 鍵可啟動控制台（真實輸入路徑，非 debug 後門）：走近後按 E，door-d 解鎖並可滑開", async ({ page }) => {
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

  // 走近控制台（距 1m，在 1.5m 提示半徑內），按 E 啟動（真實鍵盤事件，經 core/input.ts
  // consumeInteract() 邊緣觸發，非 window.__p96.debug.activateConsole() 後門）。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 58, y: 0, z: -9 }));
  await page.waitForTimeout(100);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(100);

  // 走近 door-d（2m 觸發半徑內）：控制台已啟動，門應解鎖並開始滑開。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 61, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.doorState("door-d") === "open", undefined, { timeout: 3_000 });

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});
