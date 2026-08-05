// Playwright 真瀏覽器閘門：M2 遊戲狀態機（menu／playing／paused）與設定系統（靈敏度／音量／FOV，
// localStorage 持久化）。對應本次派工規格三項驗收 (a)(b)(c)：
// (a) menu 狀態下空白鍵與滑鼠不觸發射擊、敵人不動。
// (b) playing → paused：敵人與模擬完全凍結（1 秒內 transforms 全等）。
// (c) 設定變更持久化，reload 後 localStorage 與執行期實際套用值皆一致。
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
});
