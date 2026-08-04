// Playwright 真瀏覽器閘門：M1 戰鬥流程。用 window.__p96 debug hooks 驅動：
// 初始 3 隻巡行體 → aimAt 加 fire 連打至 0 → damagePlayer(100) 觸發死亡畫面 →
// 3 秒後自動重生，敵人與彈藥從種子重建、HP 回滿。全程無 console error／pageerror。
import { test, expect } from "@playwright/test";
// window.__p96 型別宣告見 src/types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效）。

const FIRE_COOLDOWN_MS = 1000 / 3; // PLAN §3.3：脈衝手槍射速 3 發/秒
const WAIT_BETWEEN_SHOTS_MS = Math.ceil(FIRE_COOLDOWN_MS) + 60; // 留些餘裕避免卡在冷卻邊界

test("M1 戰鬥流程：擊殺 3 隻巡行體、玩家死亡與重生，全程無 console error", async ({ page }) => {
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

  // 初始 3 隻巡行體存活
  const initialAlive = await page.evaluate(() => window.__p96!.enemiesAlive());
  expect(initialAlive).toBe(3);

  // 依序擊殺每隻敵人：aimAt(0) 永遠指向目前仍存活的第一隻（前一隻死後會遞補）。
  // 敵人偵測到玩家後會朝玩家追擊移動，因此每次開火前都要重新 aimAt 校正瞄準線，
  // 不能只在回合開頭瞄一次；3 發（12x3=36 > HP 30）理論上足以擊殺，多給幾發餘裕。
  for (let enemyRound = 0; enemyRound < 3; enemyRound++) {
    let aliveBefore = await page.evaluate(() => window.__p96!.enemiesAlive());
    for (let shot = 0; shot < 10 && aliveBefore > 3 - enemyRound - 1; shot++) {
      const aimed = await page.evaluate(() => window.__p96!.aimAt(0));
      expect(aimed, `第 ${enemyRound + 1} 隻敵人第 ${shot + 1} 發前 aimAt(0) 應成功`).toBe(true);
      await page.evaluate(() => window.__p96!.fire());
      await page.waitForTimeout(WAIT_BETWEEN_SHOTS_MS);
      aliveBefore = await page.evaluate(() => window.__p96!.enemiesAlive());
    }
    expect(aliveBefore, `第 ${enemyRound + 1} 隻敵人擊殺後存活數應遞減`).toBe(3 - enemyRound - 1);
  }

  const aliveAfterCombat = await page.evaluate(() => window.__p96!.enemiesAlive());
  expect(aliveAfterCombat).toBe(0);

  // 玩家死亡：死亡畫面出現，HP 歸零
  const damaged = await page.evaluate(() => window.__p96!.damagePlayer(100));
  expect(damaged).toBe(true);
  expect(await page.evaluate(() => window.__p96!.playerHp())).toBe(0);

  const deathPanel = page.locator("#p96-death-panel");
  await expect(deathPanel).toBeVisible();

  // 3 秒後自動從種子重來：敵人回 3、玩家 HP 回 100、死亡畫面消失
  await page.waitForFunction(() => (window.__p96?.playerHp() ?? -1) === 100, undefined, { timeout: 6_000 });
  await expect(deathPanel).toBeHidden();
  expect(await page.evaluate(() => window.__p96!.enemiesAlive())).toBe(3);
  expect(await page.evaluate(() => window.__p96!.playerHp())).toBe(100);

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});
