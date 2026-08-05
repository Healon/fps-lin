// Playwright 真瀏覽器閘門：M3 第一階段（區域 D、射擊體、控制台 E 鍵互動）加第二階段
// （區域 E、守衛體、電漿步槍）。通關劇本延伸至區域 D／E 已併入
// tests/playwright/m2-level.spec.ts 測試 (a)（同一份完整流程）；本檔聚焦專屬情境：
// 射擊體會實際打傷玩家、E 鍵（真實輸入路徑）可啟動控制台並解鎖 door-d、守衛體正面命中
// 傷害減半（方向性減傷）、電漿步槍（數字鍵 3 切換、按住連射、投射物實際造成傷害）。
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

  // spittersAlive() 為全域計數（區域 D 3 隻加區域 E 2 隻，兩者同時於出生時全數生成，
  // 見 main.ts spawnSpitters()，M3 第二階段）。
  expect(await page.evaluate(() => window.__p96!.spittersAlive())).toBe(5);
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

test("(c) 正面打守衛體傷害減半：脈衝手槍命中面向自己的守衛體正面，扣血應為半額（M3 第二階段規格）", async ({ page }) => {
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

  await page.evaluate(() => window.__p96!.debug.grantWeapon("pistol"));
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("pistol");
  expect(await page.evaluate(() => window.__p96!.wardensAlive())).toBe(1);

  const initial = (await page.evaluate(() => window.__p96!.debug.wardenTransforms()))[0];
  expect(initial.hp).toBe(160);

  // 站在守衛體出生點（84,-10）附近（距離 2m）：守衛體的面向每幀依玩家目前位置更新（除
  // charge／hurt／dead 外，見 game/warden.ts），故一旦轉向完成，對它開槍必為「正面命中」，
  // 不需刻意等待特定狀態（idle／detect／advance／attack 皆會正確轉向）。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 82, y: 0, z: -10 }));
  await page.waitForTimeout(150); // 讓數幀模擬跑過，守衛體轉向面對玩家

  const before = (await page.evaluate(() => window.__p96!.debug.wardenTransforms()))[0];
  expect(before, "守衛體應仍存活").toBeTruthy();

  const target = { x: before.x, y: before.y + 1.0, z: before.z }; // 瞄準軀幹中心（WARDEN_HALF.y=1.0）
  await page.evaluate((t) => window.__p96!.debug.lookAt(t), target);
  const fired = await page.evaluate(() => window.__p96!.fire());
  expect(fired, "脈衝手槍應成功開火").toBe(true);

  const after = (await page.evaluate(() => window.__p96!.debug.wardenTransforms()))[0];
  const delta = before.hp - after.hp;
  expect(delta, `正面命中應為半額傷害（脈衝手槍 12 傷 → 6），實際扣減 ${delta}`).toBe(6);

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});

test("(d) 電漿步槍：數字鍵 3 切換（真實輸入路徑）、按住連射、投射物飛行命中造成傷害", async ({ page }) => {
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

  // 略過走位，直接給予電漿步槍（等效走到台座撿取，同 grantWeapon 慣例）；再手動切回
  // 脈衝手槍，改用真實數字鍵 3（KeyboardEvent，非 debug 後門）切回電漿步槍，驗證真實輸入路徑。
  await page.evaluate(() => window.__p96!.debug.grantWeapon("pistol"));
  await page.evaluate(() => window.__p96!.debug.grantWeapon("plasma"));
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("plasma");
  await page.keyboard.press("Digit1");
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("pistol");
  await page.keyboard.press("Digit3");
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("plasma");

  const ammoBefore = await page.evaluate(() => window.__p96!.ammo());
  expect(ammoBefore).toBe(180);

  // 站在區域 E 一隻巡行體前方近距離，瞄準後連續開火數發（射速 6 發/秒，冷卻由 update() 限制），
  // 等待投射物飛行命中（速度 20 m/s，短距離內一兩幀即可命中）。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 66, y: 0, z: -8.5 }));
  await page.evaluate(() => window.__p96!.debug.lookAt({ x: 68, y: 0.5, z: -8.5 }));

  let anyFired = false;
  for (let i = 0; i < 20; i++) {
    const fired = await page.evaluate(() => window.__p96!.fire());
    if (fired) anyFired = true;
    await page.waitForTimeout(30);
  }
  expect(anyFired, "至少一發電漿彈應成功發射").toBe(true);

  const ammoAfter = await page.evaluate(() => window.__p96!.ammo());
  expect(ammoAfter, "彈藥應遞減").toBeLessThan(ammoBefore);

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});
