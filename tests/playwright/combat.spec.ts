// Playwright 真瀏覽器閘門：戰鬥流程（脈衝手槍擊殺區域 B 的 3 隻巡行體、玩家死亡與重生）。
// 用 window.__p96 debug hooks 驅動：進入 playing → grantWeapon('pistol')（撿取前赤手空拳，
// 不可開火，見 game/inventory.ts）→ aimAt 加 fire 連打至 0 → damagePlayer(100) 觸發死亡畫面 →
// 3 秒後自動重生，敵人與彈藥從種子重建、HP 回滿。全程無 console error／pageerror。
//
// 2026-08-04（M2 第二階段）：取代 M0/M1 單一測試房後，出生點附近不再有敵人（巡行體改在
// 區域 B），且玩家出生時赤手空拳（PLAN 本次派工規格：撿取前不可開火），本測試改用
// debug.grantWeapon('pistol') 直接裝備手槍再開戰，其餘擊殺／死亡／重生劇本邏輯不變
// （區域 B 巡行體數量沿用 3 隻，恰與 M1 版本相同，aimAt／enemiesAlive 等 debug hook 皆為
// 泛用實作，不依賴關卡內容）。
// 2026-08-05（M3 第二階段）：區域 E 的 4 隻巡行體與區域 B 同慣例，出生即 idle 常駐存活
// （見 main.ts spawnAreaEnemies("E","idle")），enemiesAlive() 為全域計數會把它們一併算入。
// 本測試玩家全程待在區域 B（離區域 E 很遠，不會觸發其偵測），故用 AREA_E_IDLE_COUNT 常數
// 偏移，維持「擊殺區域 B 3 隻」的測試意圖不變；enemies 陣列出生順序為 B 先於 E
// （main.ts：[...spawnAreaEnemies("B",...), ...spawnAreaEnemies("E",...)]），
// aimAt(0) 依序命中的仍是區域 B 的 3 隻，不受影響。
import { test, expect } from "@playwright/test";
// window.__p96 型別宣告見 src/types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效）。

const FIRE_COOLDOWN_MS = 1000 / 3; // PLAN §3.3：脈衝手槍射速 3 發/秒
const WAIT_BETWEEN_SHOTS_MS = Math.ceil(FIRE_COOLDOWN_MS) + 60; // 留些餘裕避免卡在冷卻邊界
const AREA_E_IDLE_COUNT = 4; // 區域 E 巡行體數（本測試全程不觸碰，維持常駐存活）

test("M2 戰鬥流程：擊殺區域 B 的 3 隻巡行體、玩家死亡與重生，全程無 console error", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  await page.goto("/");
  await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });

  // 進入 playing 狀態。
  await page.locator("#p96-start-overlay").click();
  await page.keyboard.press("Enter"); // 跳過開場文字（M3 第三階段新增，見 ui/menu.ts IntroScreen：任意鍵跳過）
  await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });

  // 撿取前赤手空拳：ammo() 回 0，直接 grantWeapon 裝備脈衝手槍（等效走到台座撿取）。
  expect(await page.evaluate(() => window.__p96!.ammo())).toBe(0);
  await page.evaluate(() => window.__p96!.debug.grantWeapon("pistol"));
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("pistol");

  // 巡行體在區域 B（離出生點很遠，且中間隔著走廊牆面與門 A），raycast 命中判定需要玩家
  // 實際站在同一空間內才有清楚視線；用 debug.teleportPlayer 跳過走位，直接站到區域 B 中央。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 16, y: 0, z: -10 }));

  // 區域 B 初始 3 隻巡行體存活加區域 E 常駐 4 隻（本測試不觸碰，見上方檔頭註解）。
  const initialAlive = await page.evaluate(() => window.__p96!.enemiesAlive());
  expect(initialAlive).toBe(3 + AREA_E_IDLE_COUNT);

  // 依序擊殺每隻敵人：aimAt(0) 永遠指向目前仍存活的第一隻（前一隻死後會遞補，區域 B 排在
  // 陣列最前面，見上方檔頭註解，故 aimAt(0) 命中的必為區域 B 的 3 隻）。
  for (let enemyRound = 0; enemyRound < 3; enemyRound++) {
    let aliveBefore = await page.evaluate(() => window.__p96!.enemiesAlive());
    for (let shot = 0; shot < 10 && aliveBefore > 3 - enemyRound - 1 + AREA_E_IDLE_COUNT; shot++) {
      const aimed = await page.evaluate(() => window.__p96!.aimAt(0));
      expect(aimed, `第 ${enemyRound + 1} 隻敵人第 ${shot + 1} 發前 aimAt(0) 應成功`).toBe(true);
      await page.evaluate(() => window.__p96!.fire());
      await page.waitForTimeout(WAIT_BETWEEN_SHOTS_MS);
      aliveBefore = await page.evaluate(() => window.__p96!.enemiesAlive());
    }
    expect(aliveBefore, `第 ${enemyRound + 1} 隻敵人擊殺後存活數應遞減`).toBe(3 - enemyRound - 1 + AREA_E_IDLE_COUNT);
  }

  const aliveAfterCombat = await page.evaluate(() => window.__p96!.enemiesAlive());
  expect(aliveAfterCombat).toBe(AREA_E_IDLE_COUNT);
  expect(await page.evaluate(() => window.__p96!.kills())).toBeGreaterThanOrEqual(3);

  // 玩家死亡：死亡畫面出現，HP 歸零
  const damaged = await page.evaluate(() => window.__p96!.damagePlayer(100));
  expect(damaged).toBe(true);
  expect(await page.evaluate(() => window.__p96!.playerHp())).toBe(0);

  const deathPanel = page.locator("#p96-death-panel");
  await expect(deathPanel).toBeVisible();

  // 3 秒後自動從種子重來：敵人回 3+4、玩家 HP 回 100、死亡畫面消失
  await page.waitForFunction(() => (window.__p96?.playerHp() ?? -1) === 100, undefined, { timeout: 6_000 });
  await expect(deathPanel).toBeHidden();
  expect(await page.evaluate(() => window.__p96!.enemiesAlive())).toBe(3 + AREA_E_IDLE_COUNT);
  expect(await page.evaluate(() => window.__p96!.playerHp())).toBe(100);

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});
