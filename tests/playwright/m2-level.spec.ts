// Playwright 真瀏覽器閘門：M2 第二階段垂直切片主體（區域 A 至 C、門系統、撿取系統、散射槍、
// 通關畫面）。用 window.__p96 debug hooks（teleportPlayer／grantWeapon／clearArea／doorState／
// lookAt）跳過長距離走位與戰鬥磨耗，聚焦驗證關卡流程本身的正確性；實際射擊命中判定另由
// tests/playwright/combat.spec.ts 覆蓋，戰鬥手感非本檔重點。
import { test, expect } from "@playwright/test";
// window.__p96 型別宣告見 src/types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效）。

test("(a) 完整通關劇本：出生 → 撿手槍 → 門 A 開 → 清 B → 門 B 開 → 撿散射槍觸發伏擊 → 清 C → door-c 開 → 區域 D → 啟動控制台 → door-d 開 → 區域 E → 清空 → door-e 開 → 區域 F 前廳 → 撿能量砲 → door-f 開 → 跨入首領大廳（鎖門）→ 擊殺首領 → 真結局", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");
  await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });
  await page.locator("#p96-start-overlay").click();
  await page.keyboard.press("Enter"); // 跳過開場文字（M3 第三階段新增，見 ui/menu.ts IntroScreen：任意鍵跳過）
  await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });

  // 出生：赤手空拳，門 A 鎖定。
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBeNull();
  expect(await page.evaluate(() => window.__p96!.debug.doorState("door-a"))).toBe("closed");

  // 撿手槍（grantWeapon 等效走到台座）：門 A 開啟需玩家在 2m 內，一併 teleport 靠近。
  await page.evaluate(() => window.__p96!.debug.grantWeapon("pistol"));
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("pistol");
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 0, y: 0, z: -3 }));
  await page.waitForFunction(() => window.__p96!.debug.doorState("door-a") === "open", undefined, { timeout: 3_000 });

  // 清區域 B（clearArea 等效擊殺全部）：門 B 開啟需玩家在 2m 內。
  await page.evaluate(() => window.__p96!.debug.clearArea("B"));
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 25, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.doorState("door-b") === "open", undefined, { timeout: 3_000 });

  // 撿散射槍：觸發伏擊，區域 C 6 隻巡行體出現且直接進 chase（跳過 idle 偵測，direct aggro）。
  // 區域 E 的 4 隻巡行體自出生即常駐存活（見 main.ts spawnAreaEnemies("E","idle")），
  // enemiesAlive() 為全域計數，故此處預期值需加上 4（M3 第二階段）。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 35, y: 0, z: -10 }));
  await page.evaluate(() => window.__p96!.debug.grantWeapon("shotgun"));
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("shotgun");
  expect(await page.evaluate(() => window.__p96!.enemiesAlive())).toBe(6 + 4);
  const ambushStates = await page.evaluate(() =>
    window.__p96!.debug
      .enemyTransforms()
      .filter((e) => e.area === "C")
      .map((e) => e.state),
  );
  expect(ambushStates.length).toBe(6);
  expect(ambushStates.every((s) => s !== "idle"), `伏擊組（區域 C）應直接進 chase，實際狀態：${ambushStates.join(",")}`).toBe(true);

  // 清區域 C：door-c 開啟需玩家在 2m 內（door-c 原名 door-end，M3 起改為通往區域 D）。
  await page.evaluate(() => window.__p96!.debug.clearArea("C"));
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 43, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.doorState("door-c") === "open", undefined, { timeout: 3_000 });

  // 走入區域 D：3 隻射擊體出現（不與巡行體共用陣列，見 window.__p96.spittersAlive）；
  // 區域 E 的 2 隻射擊體與 D 同陣列同時出生（spawnSpitters() 一次生成全部區域），
  // spittersAlive() 為全域計數，故此處預期值為 3＋2＝5（M3 第二階段）。
  // door-d 尚未解鎖（控制台未啟動，本次派工規格：door-d 只看控制台不要求清敵）。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 55, y: 0, z: -10 }));
  expect(await page.evaluate(() => window.__p96!.spittersAlive())).toBe(3 + 2);
  expect(await page.evaluate(() => window.__p96!.debug.doorState("door-d"))).toBe("closed");

  // 啟動控制台（debug 後門，略過走近距離）：door-d 走近後應解鎖並滑開。
  await page.evaluate(() => window.__p96!.debug.activateConsole());
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 61, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.doorState("door-d") === "open", undefined, { timeout: 3_000 });

  // M3 第二階段：走入區域 E 核心通道——4 巡行體＋2 射擊體＋1 守衛體混編（見 procgen/level/level.ts）。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 70, y: 0, z: -10 }));
  expect(await page.evaluate(() => window.__p96!.enemiesAlive())).toBe(4); // 區域 B／C 已清空，僅餘區域 E
  expect(await page.evaluate(() => window.__p96!.spittersAlive())).toBe(3 + 2); // 區域 D 未清（door-d 不要求），加區域 E
  expect(await page.evaluate(() => window.__p96!.wardensAlive())).toBe(1);
  expect(await page.evaluate(() => window.__p96!.debug.doorState("door-e"))).toBe("closed");

  // 清區域 E（巡行體加射擊體加守衛體）：door-e 開啟需玩家在 2m 內。
  await page.evaluate(() => window.__p96!.debug.clearArea("E"));
  expect(await page.evaluate(() => window.__p96!.enemiesAlive())).toBe(0);
  expect(await page.evaluate(() => window.__p96!.spittersAlive())).toBe(3); // 僅餘未清的區域 D
  expect(await page.evaluate(() => window.__p96!.wardensAlive())).toBe(0);
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 85, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.doorState("door-e") === "open", undefined, { timeout: 3_000 });

  // M3 第三階段：區域 F 前廳（能量砲台座、彈藥醫療補給站）。撿能量砲。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 90, y: 0, z: -10 }));
  await page.evaluate(() => window.__p96!.debug.grantWeapon("cannon"));
  expect(await page.evaluate(() => window.__p96!.currentWeapon())).toBe("cannon");
  expect(await page.evaluate(() => window.__p96!.ammo())).toBe(12);

  // door-f（首領戰大門）：無條件，走近即開。
  expect(await page.evaluate(() => window.__p96!.debug.doorState("door-f"))).toBe("closed");
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 96.5, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.doorState("door-f") === "open", undefined, { timeout: 3_000 });

  // 跨入首領大廳：門立即永久鎖住（locked），首領啟動，HUD 首領血條可讀（bossTransform 非 inactive）。
  await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 105, y: 0, z: -10 }));
  await page.waitForFunction(() => window.__p96!.debug.doorState("door-f") === "locked", undefined, { timeout: 3_000 });
  expect(await page.evaluate(() => window.__p96!.bossAlive())).toBe(true);
  await page.waitForFunction(() => window.__p96!.debug.bossTransform().state !== "inactive", undefined, { timeout: 3_000 });

  // 擊殺首領（debug 壓 HP 至 0，等效戰勝，跳過完整戰鬥磨耗——首領戰鬥細節另由
  // tests/playwright/m3-boss.spec.ts 覆蓋）：核心過載序列播完（約 2 秒）後應進入真結局。
  await page.evaluate(() => window.__p96!.debug.setBossHp(0));
  expect(await page.evaluate(() => window.__p96!.bossAlive())).toBe(false);
  await page.waitForFunction(() => window.__p96?.gameState === "complete", undefined, { timeout: 5_000 });

  const winPanel = page.locator("#p96-win-overlay");
  await expect(winPanel).toBeVisible();
  const narrativeText = await page.locator('[data-role="win-narrative"]').textContent();
  expect(narrativeText).toContain("任務完成");
  const statsText = await page.locator('[data-role="win-stats"]').textContent();
  expect(statsText).toContain("擊殺數");
  expect(statsText).toContain("通關時間");
  expect(await page.evaluate(() => window.__p96!.kills())).toBeGreaterThanOrEqual(16); // 3（B）+ 6（C）+ 4+2+1（E）

  // 回主選單：可重新開始完整流程。
  await page.locator('[data-role="win-return-menu"]').click();
  await page.waitForFunction(() => window.__p96?.gameState === "menu", undefined, { timeout: 3_000 });
  await expect(winPanel).toBeHidden();

  expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
});

test("(b) 門 B 在區域 B 未清前保持關閉：走近不開，collider 仍擋住移動", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });
  await page.locator("#p96-start-overlay").click();
  await page.keyboard.press("Enter"); // 跳過開場文字（M3 第三階段新增，見 ui/menu.ts IntroScreen：任意鍵跳過）
  await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });

  // 不清區域 B，直接靠近門 B 並面向它。
  await page.evaluate(() => {
    window.__p96!.debug.teleportPlayer({ x: 24.5, y: 0, z: -10 });
    window.__p96!.debug.lookAt({ x: 30, y: 0, z: -10 });
  });
  await page.waitForTimeout(300); // 給門系統數幀時間評估條件（應仍鎖定，不開）
  expect(await page.evaluate(() => window.__p96!.debug.doorState("door-b"))).toBe("closed");

  // 持續朝門 B 方向走：collider 應擋住，玩家不應越過 x=26。
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1000);
  await page.keyboard.up("KeyW");

  const pos = await page.evaluate(() => window.__p96!.debug.getPlayerPosition());
  expect(pos.x, `門 B 關閉時不應被走過，實際 x=${pos.x}`).toBeLessThan(26);
  expect(await page.evaluate(() => window.__p96!.debug.doorState("door-b"))).toBe("closed");
});
