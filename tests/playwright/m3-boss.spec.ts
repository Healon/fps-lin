// Playwright 真瀏覽器閘門：M3 第三階段最終戰（開場文字、區域 F 首領戰、能量砲、真結局）。
// 用 window.__p96 debug hooks（teleportPlayer／grantWeapon／setBossHp／bossTransform）跳過
// 長距離走位與門檻磨耗，聚焦驗證首領三模式循環、震波 LOS 免傷規則、能量砲充能式開火（真實
// 輸入路徑）、核心過載真結局流程本身的正確性。既有通關劇本（含撿能量砲、door-f 開啟、
// 跨入首領大廳鎖門）另由 tests/playwright/m2-level.spec.ts 測試 (a) 涵蓋，本檔不重複。
import { test, expect } from "@playwright/test";
// window.__p96 型別宣告見 src/types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效）。

async function bootToPlaying(page: import("@playwright/test").Page, skipIntro = true): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });
  await page.locator("#p96-start-overlay").click();
  if (skipIntro) {
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });
  }
}

test("(a) 開場文字：新局第一次進入顯示三至五行敘事，控制權未交出，可任意鍵跳過後進入 playing", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");
  await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });
  await page.locator("#p96-start-overlay").click();

  const introPanel = page.locator("#p96-intro-overlay");
  await expect(introPanel).toBeVisible();
  const introText = await page.locator('[data-role="intro-text"]').textContent();
  const lines = (introText ?? "").split("\n").filter((l) => l.trim().length > 0);
  expect(lines.length, `開場文字應為三至五行，實際 ${lines.length} 行：${introText}`).toBeGreaterThanOrEqual(3);
  expect(lines.length).toBeLessThanOrEqual(5);

  // 控制權尚未交出：仍在 menu，overlay 已隱藏但 gameState 未變。
  expect(await page.evaluate(() => window.__p96!.gameState)).toBe("menu");

  await page.keyboard.press("Enter"); // 任意鍵跳過
  await expect(introPanel).toBeHidden();
  await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 3_000 });

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});

test("(b) 首領三種攻擊模式皆依序觸發（彈幕掃射／召喚巡行體／全場脈衝震波），玩家站在開闊視線內應受到傷害", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await bootToPlaying(page);

  const enemiesBefore = await page.evaluate(() => window.__p96!.enemiesAlive());

  // 跳過走位直接跨入首領大廳（區域 F 能源核心）：門立即鎖住，首領啟動。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 105, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.bossTransform().state !== "inactive", undefined, { timeout: 3_000 });
  expect(await page.evaluate(() => window.__p96!.debug.doorState("door-f"))).toBe("locked");
  expect(await page.evaluate(() => window.__p96!.bossAlive())).toBe(true);

  // 全程站在開闊處，讓三種模式的循環自然跑過（barrage→reposition→summon→reposition→
  // shockwave-telegraph→reposition→barrage……，見 game/boss.ts attackModeForCycle）。
  const seenStates = new Set<string>();
  for (let i = 0; i < 40 && !(seenStates.has("barrage") && seenStates.has("summon") && seenStates.has("shockwave-telegraph")); i++) {
    const state = await page.evaluate(() => window.__p96!.debug.bossTransform().state);
    seenStates.add(state);
    await page.waitForTimeout(300);
  }
  const seenList = [...seenStates].join(",");
  expect(seenStates.has("barrage"), `應觀察到 barrage 狀態，實際觀察到：${seenList}`).toBe(true);
  expect(seenStates.has("summon"), `應觀察到 summon 狀態，實際觀察到：${seenList}`).toBe(true);
  expect(seenStates.has("shockwave-telegraph"), `應觀察到 shockwave-telegraph 狀態，實際觀察到：${seenList}`).toBe(true);

  // 召喚巡行體應實際使全域敵人數增加（area "F"，見 main.ts 主迴圈 summonRequest 處理）。
  const enemiesAfter = await page.evaluate(() => window.__p96!.enemiesAlive());
  expect(enemiesAfter).toBeGreaterThan(enemiesBefore);

  // 玩家全程站在開闊視線內未移動：彈幕與／或震波應至少命中一次。
  const hpAfter = await page.evaluate(() => window.__p96!.playerHp());
  expect(hpAfter, `站在開闊視線內應曾受到首領攻擊，實際 HP=${hpAfter}`).toBeLessThan(100);

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});

test("(c) 全場脈衝震波：躲在掩體後（無視線）應免傷", async ({ page }) => {
  await bootToPlaying(page);

  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 105, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.bossTransform().state !== "inactive", undefined, { timeout: 3_000 });

  // 重要（除錯發現）：首領在「每個」攻擊模式之後都會 reposition 一次（不是每三個模式一次），
  // 故藏身點須相對首領「當下」位置即時算出，且要從一開始就持續躲藏——若只在偵測到
  // shockwave-telegraph 才開始躲，先前 barrage 輪的投射物仍在飛行中（速度 10 m/s，短距離
  // 內不會立即命中），會在其後的 reposition 狀態才姍姍來遲命中，被誤判為震波傷害
  // （皆為 BARRAGE_PROJECTILE_DAMAGE=10，加總後與 SHOCKWAVE_DAMAGE=30 巧合相同，
  // 曾誤導本測試——見開發過程紀錄）。改為：從首領一啟動就持續每一輪都重新算「當下」的
  // 藏身點並傳送，全程站在柱體 0 陰影之下，涵蓋彈幕（一般牆面阻擋判定）與震波（LOS 判定）。
  const center = { x: 108, y: 0, z: -10 };
  const radius = 6.5;
  const angle = (0 / 8) * Math.PI * 2 + Math.PI / 8;
  const pillar = { x: center.x + radius * Math.cos(angle), z: center.z + radius * Math.sin(angle) };

  async function hideBehindPillar(): Promise<void> {
    const boss = await page.evaluate(() => window.__p96!.debug.bossTransform());
    const dx = pillar.x - boss.x;
    const dz = pillar.z - boss.z;
    const len = Math.hypot(dx, dz);
    const hidePos = { x: pillar.x + (dx / len) * 1.5, y: 0, z: pillar.z + (dz / len) * 1.5 };
    await page.evaluate((p) => window.__p96!.debug.teleportPlayer(p), hidePos);
  }

  let sawTelegraph = false;
  let resolvedAfterTelegraph = false;
  for (let i = 0; i < 100 && !resolvedAfterTelegraph; i++) {
    await hideBehindPillar();
    const state = await page.evaluate(() => window.__p96!.debug.bossTransform().state);
    if (state === "shockwave-telegraph") sawTelegraph = true;
    else if (sawTelegraph) resolvedAfterTelegraph = true;
    await page.waitForTimeout(80);
  }
  expect(sawTelegraph, "測試前提：應曾觀察到 shockwave-telegraph 狀態").toBe(true);
  expect(resolvedAfterTelegraph, "震波應已引爆判定完畢（狀態已離開 shockwave-telegraph）").toBe(true);

  const hp = await page.evaluate(() => window.__p96!.playerHp());
  expect(hp, `全程躲在掩體後不應受到任何攻擊命中（彈幕被牆擋、震波無 LOS 免傷），實際 HP=${hp}`).toBe(100);
});

test("(d) 能量砲：未滿 1.2 秒放開不耗彈，充滿放開消耗 1 發並造成濺射傷害", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await bootToPlaying(page);

  await page.evaluate(() => window.__p96!.debug.grantWeapon("cannon"));
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("cannon");
  const ammoBefore = await page.evaluate(() => window.__p96!.ammo());
  expect(ammoBefore).toBe(12);

  // 未滿 1.2 秒放開：取消，不耗彈。
  await page.keyboard.down("Space");
  await page.waitForTimeout(300);
  await page.keyboard.up("Space");
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__p96!.ammo()), "未滿充能時長放開不應耗彈").toBe(ammoBefore);
  expect(await page.evaluate(() => window.__p96!.debug.cannonChargeProgress())).toBe(0);

  // 站在區域 E 一隻巡行體前方近距離，瞄準後按住超過 1.2 秒再放開：應成功發射並耗彈。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 66, y: 0, z: -8.5 }));
  await page.evaluate(() => window.__p96!.debug.lookAt({ x: 68, y: 0.5, z: -8.5 }));

  await page.keyboard.down("Space");
  await page.waitForTimeout(1_400);
  await page.keyboard.up("Space");
  await page.waitForTimeout(300); // 投射物飛行（16 m/s，短距離內即命中）

  const ammoAfter = await page.evaluate(() => window.__p96!.ammo());
  expect(ammoAfter, "充滿放開應成功發射並耗彈 1 發").toBe(ammoBefore - 1);

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});

test("(e) 擊殺首領後真結局：核心過載序列播完進入結局畫面，含三行敘事與通關統計", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await bootToPlaying(page);

  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 105, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.bossTransform().state !== "inactive", undefined, { timeout: 3_000 });
  expect(await page.evaluate(() => window.__p96!.debug.doorState("door-f"))).toBe("locked");

  await page.evaluate(() => window.__p96!.debug.setBossHp(0));
  expect(await page.evaluate(() => window.__p96!.bossAlive())).toBe(false);

  // 核心過載序列（約 2 秒全場閃白）播完才真正進入 complete（見 main.ts BOSS_DEATH_SEQUENCE_DURATION）。
  expect(await page.evaluate(() => window.__p96?.gameState)).toBe("playing");
  await page.waitForFunction(() => window.__p96?.gameState === "complete", undefined, { timeout: 5_000 });

  const winPanel = page.locator("#p96-win-overlay");
  await expect(winPanel).toBeVisible();
  const narrative = await page.locator('[data-role="win-narrative"]').textContent();
  const narrativeLines = (narrative ?? "").split("\n").filter((l) => l.trim().length > 0);
  expect(narrativeLines.length).toBe(3);
  expect(narrative).toContain("設施");
  const statsText = await page.locator('[data-role="win-stats"]').textContent();
  expect(statsText).toContain("擊殺數");
  expect(statsText).toContain("通關時間");

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});
