// Playwright 真瀏覽器閘門：M2 遊戲狀態機（menu／playing／paused）與設定系統（靈敏度／音量／FOV，
// localStorage 持久化）。對應本次派工規格三項驗收 (a)(b)(c)：
// (a) menu 狀態下空白鍵與滑鼠不觸發射擊、敵人不動。
// (b) playing → paused：敵人與模擬完全凍結（1 秒內 transforms 全等）。
// (c) 設定變更持久化，reload 後 localStorage 與執行期實際套用值皆一致。
// (d)（M3 第四階段新增）按鍵重設：Esc 取消擷取不變更綁定、衝突時互換、重綁射擊鍵後新鍵實際
// 開火而舊鍵失效、reload 後綁定持久化。真實輸入路徑（非 debug.fire()），驗證 InputManager
// 的映射確實套用，不只是資料層 KeyBindingStore 本身（那部分已由 tests/unit/settings.test.ts
// 涵蓋，本測試補的是「真瀏覽器下鍵真的能用」，呼應 PLAN §8.1 分層原則）。
import { test, expect } from "@playwright/test";
// window.__p96 型別宣告見 src/types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效）。

test.describe("M2 遊戲狀態機與設定系統", () => {
  test("(a) menu 狀態：空白鍵與滑鼠不觸發射擊，敵人不移動", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });

    expect(await page.evaluate(() => window.__p96!.gameState)).toBe("menu");
    const ammoBefore = await page.evaluate(() => window.__p96!.ammo());
    const transformsBefore = await page.evaluate(() => window.__p96!.debug.enemyTransforms());

    // 空白鍵（D-005 射擊鍵之一）：對應 HANDOFF 待辦第 3 條原始 bug 情境「點擊前按空白鍵會真的開槍」。
    await page.keyboard.down("Space");
    await page.waitForTimeout(200);
    await page.keyboard.up("Space");

    // 滑鼠左鍵：直接對 canvas 派發 mousedown／mouseup（menu 狀態下 overlay 覆蓋全螢幕，
    // 此處模擬事件萬一穿透到 canvas 的迴歸情境，驗證狀態閘本身能擋下而非僅靠 overlay 遮擋）。
    await page.locator("#glcanvas").dispatchEvent("mousedown", { button: 0 });
    await page.locator("#glcanvas").dispatchEvent("mouseup", { button: 0 });
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__p96!.gameState)).toBe("menu");
    expect(await page.evaluate(() => window.__p96!.ammo())).toBe(ammoBefore);
    const transformsAfter = await page.evaluate(() => window.__p96!.debug.enemyTransforms());
    expect(transformsAfter).toEqual(transformsBefore);

    expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
    expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
  });

  test("(b) paused 狀態：敵人與模擬完全凍結，暫停選單顯示", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });

    await page.locator("#p96-start-overlay").click();
    await page.keyboard.press("Enter"); // 跳過開場文字（M3 第三階段新增，見 ui/menu.ts IntroScreen：任意鍵跳過）
    await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });

    // M2 第二階段：巡行體改在區域 B（離出生點甚遠，出生點附近站著不動不會進入偵測範圍），
    // 用 debug.teleportPlayer 把玩家直接送到區域 B 巡行體偵測範圍內，讓敵人先真正動一陣子，
    // 確保後續的「凍結」是相對於原本會動而言，不是本來就靜止（沿用 M1 版本測試意圖）。
    await page.evaluate(() => window.__p96!.debug.teleportPlayer({ x: 9, y: 0, z: -8 }));
    await page.waitForTimeout(500);

    await page.evaluate(() => window.__p96!.debug.setState("paused"));
    expect(await page.evaluate(() => window.__p96!.gameState)).toBe("paused");
    await expect(page.locator("#p96-pause-overlay")).toBeVisible();

    const before = await page.evaluate(() => window.__p96!.debug.enemyTransforms());
    const hpBefore = await page.evaluate(() => window.__p96!.playerHp());
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => window.__p96!.debug.enemyTransforms());
    const hpAfter = await page.evaluate(() => window.__p96!.playerHp());

    expect(after).toEqual(before);
    expect(hpAfter).toBe(hpBefore);

    // 繼續：應重新回到 playing，暫停選單收起。
    await page.locator('[data-role="pause-resume"]').click();
    await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });
    await expect(page.locator("#p96-pause-overlay")).toBeHidden();
  });

  test("(c) 設定：調整靈敏度與 FOV 後持久化，reload 後讀回一致並實際生效", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });

    // 從主選單進入設定（未進入 playing 狀態即可調整）。
    await page.locator('[data-role="menu-settings-button"]').click();
    await expect(page.locator("#p96-settings-overlay")).toBeVisible();

    // FOV 預設 90，每次＋5，點 3 次 → 105。
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-role="fov-inc"]').click();
    }
    // 靈敏度預設 1.0，每次＋0.1，點 5 次 → 1.5。
    for (let i = 0; i < 5; i++) {
      await page.locator('[data-role="sensitivity-inc"]').click();
    }

    const fovValueText = await page.locator('[data-role="fov-value"]').textContent();
    const sensitivityValueText = await page.locator('[data-role="sensitivity-value"]').textContent();
    expect(fovValueText).toBe("105°");
    expect(sensitivityValueText).toBe("1.5x");

    const settingsBeforeReload = await page.evaluate(() => window.__p96!.debug.getSettings());
    expect(settingsBeforeReload.fov).toBeCloseTo(105, 5);
    expect(settingsBeforeReload.sensitivity).toBeCloseTo(1.5, 5);

    const fovAppliedBeforeReload = await page.evaluate(() => window.__p96!.debug.getFov());
    expect(fovAppliedBeforeReload).toBeCloseTo(105, 5);

    const storedFov = await page.evaluate(() => window.localStorage.getItem("p96.settings.fov"));
    const storedSensitivity = await page.evaluate(() => window.localStorage.getItem("p96.settings.sensitivity"));
    expect(Number(storedFov)).toBeCloseTo(105, 5);
    expect(Number(storedSensitivity)).toBeCloseTo(1.5, 5);

    await page.reload();
    await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });

    const settingsAfterReload = await page.evaluate(() => window.__p96!.debug.getSettings());
    expect(settingsAfterReload.fov).toBeCloseTo(105, 5);
    expect(settingsAfterReload.sensitivity).toBeCloseTo(1.5, 5);

    const fovAppliedAfterReload = await page.evaluate(() => window.__p96!.debug.getFov());
    expect(fovAppliedAfterReload).toBeCloseTo(105, 5);
  });

  test("(d) 按鍵重設：Esc 取消不變更、衝突互換、新鍵實際開火舊鍵失效、reload 後持久化", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });

    // 從主選單進入設定。
    await page.locator('[data-role="menu-settings-button"]').click();
    await expect(page.locator("#p96-settings-overlay")).toBeVisible();

    const initialBindings = await page.evaluate(() => window.__p96!.debug.getKeyBindings());
    expect(initialBindings.fire).toBe("Space");
    expect(initialBindings.interact).toBe("KeyE");
    expect(initialBindings.right).toBe("KeyD");

    // Esc 取消擷取：點「重新綁定」後按 Esc，綁定不變，面板顯示還原成原值。
    await page.locator('[data-role="key-fire-rebind"]').click();
    await expect(page.locator('[data-role="key-fire-value"]')).toHaveText("請按下新按鍵…（Esc 取消）");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-role="key-fire-value"]')).toHaveText("空白鍵");
    expect((await page.evaluate(() => window.__p96!.debug.getKeyBindings())).fire).toBe("Space");

    // 衝突互換：把「互動」（預設 KeyE）重綁成 KeyD（目前是「右移」）；兩者應互換。
    await page.locator('[data-role="key-interact-rebind"]').click();
    await page.keyboard.press("KeyD");
    const afterSwap = await page.evaluate(() => window.__p96!.debug.getKeyBindings());
    expect(afterSwap.interact).toBe("KeyD");
    expect(afterSwap.right).toBe("KeyE"); // 互動原本的 KeyE 換給了右移
    expect(await page.locator('[data-role="key-interact-value"]').textContent()).toBe("D");
    expect(await page.locator('[data-role="key-right-value"]').textContent()).toBe("E");

    // 重綁射擊鍵為 KeyF（無衝突：KeyF 未被任何動作使用）。
    await page.locator('[data-role="key-fire-rebind"]').click();
    await page.keyboard.press("KeyF");
    const afterFireRebind = await page.evaluate(() => window.__p96!.debug.getKeyBindings());
    expect(afterFireRebind.fire).toBe("KeyF");
    expect(await page.locator('[data-role="key-fire-value"]').textContent()).toBe("F");

    // 主選單操控提示應同步反映新綁定（本次派工規格「操控提示改為動態生成」）。
    await page.locator('[data-role="settings-back"]').click();
    const hintText = await page.locator('[data-role="menu-controls-hint"]').textContent();
    expect(hintText).toContain("F：射擊");
    expect(hintText).toContain("D：互動");

    // 進入 playing，裝備脈衝手槍，驗證新鍵（F）實際開火、舊鍵（Space）失效。
    await page.locator("#p96-start-overlay").click();
    await page.keyboard.press("Enter"); // 跳過開場文字
    await page.waitForFunction(() => window.__p96?.gameState === "playing", undefined, { timeout: 5_000 });
    await page.evaluate(() => window.__p96!.debug.grantWeapon("pistol"));

    const ammoBeforeSpace = await page.evaluate(() => window.__p96!.ammo());
    await page.keyboard.down("Space");
    await page.waitForTimeout(400);
    await page.keyboard.up("Space");
    const ammoAfterSpace = await page.evaluate(() => window.__p96!.ammo());
    expect(ammoAfterSpace, "舊射擊鍵（Space）重綁後不應再觸發開火").toBe(ammoBeforeSpace);

    await page.keyboard.down("KeyF");
    await page.waitForTimeout(400); // 大於脈衝手槍冷卻（PLAN §3.3：3 發/秒，約 333ms）
    await page.keyboard.up("KeyF");
    const ammoAfterF = await page.evaluate(() => window.__p96!.ammo());
    expect(ammoAfterF, "新射擊鍵（KeyF）應實際觸發開火，彈藥減少").toBeLessThan(ammoBeforeSpace);

    // reload 後綁定持久化。
    await page.reload();
    await page.waitForFunction(() => window.__p96?.ready === true, undefined, { timeout: 10_000 });
    const afterReload = await page.evaluate(() => window.__p96!.debug.getKeyBindings());
    expect(afterReload.fire).toBe("KeyF");
    expect(afterReload.interact).toBe("KeyD");
    expect(afterReload.right).toBe("KeyE");

    expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
    expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toHaveLength(0);
  });
});
