# AC：M3 第一階段（區域 D 控制區、射擊體、共用投射物系統、E 互動鍵、容量收緊）

> 派工來源：主對話。基準 main @ 2e6dd08（feat: M2 phase 3 - procedural music, 3-engine smoke, frame probe）。
> High-Risk：否。不 commit／push／部署／刪專案外檔案／kill 非自己啟動的行程。不改 PLAN.md、HANDOFF.md。

## AC-1 關卡擴建：區域 D（src/procgen/level/level.ts）

- **Observable**：`door-c`（原 `door-end` 改名，語意由「終點門」改為「通往區域 D」，條件不變 `area-clear:C`）→ 通道 → 區域 D（約 14×10m，兩側 0.8m 平台，中央偏後控制台）→ `door-d`（條件 `console-activated`）→ 終點小空間 → 新 `endTrigger`。
- **Measurable**：`generateLevel().doors.length === 4`（A／B／C／D）；區域 D 平台為純碰撞（無跳躍能力天然不可攀爬，兩側可繞行）；`levelHash` 涵蓋新增資料（控制台位置、door-d 定義）。
- **Bounded**：不用 `Math.random`／`Date`；沿用既有 `addSolid`／`addFloorCeiling`／`aabbFromCenterHalf` 慣例；不改區域 A–C 既有座標。
- **Testable**：`tests/unit/level.test.ts` 更新斷言門數與 id；golden `tests/golden/level-hash.txt` 更新為新值並於回報中列出。

## AC-2 控制台互動（src/game/console.ts、core/input.ts、main.ts、ui/overlay.ts）

- **Observable**：玩家距控制台 1.5m 內，HUD 顯示「按 E 啟動控制台」；按 E 啟動後面板變色（`console-idle`／`console-active` 兩份 prop 網格切換）、播放合成確認音、`door-d` 由 `console-activated` 條件解鎖（仍需走近 2m 觸發滑開）。
- **Measurable**：`ConsoleSystem.tryActivate()` 在提示半徑外或已啟動時回傳 `false`；一次啟動後不可逆（`reset()` 僅供關卡重來使用）。E 鍵為邊緣觸發（`consumeInteract()`），只在 `playing` 狀態生效。
- **Bounded**：不新增音訊檔；面板變色以預生成兩份網格切換實作，不新增 renderer 的 per-instance tint uniform。
- **Testable**：`tests/unit/console.test.ts`（提示可見性、啟動成功／失敗條件、reset）；Playwright `debug.activateConsole()` 後門驗證 `door-d` 解鎖流程。

## AC-3 共用投射物系統（src/game/projectiles.ts）

- **Observable**：`ProjectileSystem.spawn({ pos, dir, speed, damage, radius, faction, color })`；`update(dt, colliders, targetQuery)` 回傳命中事件陣列；enemy 陣營打玩家、player 陣營打敵人（本階段僅 enemy→玩家有實際呼叫端，player 陣營為電漿步槍／首領戰預留介面）。
- **Measurable**：每發最長存活 3 秒（`age > 3` 即消滅，無命中事件）；命中關卡牆面即消滅且不回報命中事件；命中目標即消滅並回報 `{faction, target, point, died}`；先命中者算（牆與目標中取最近交點）。
- **Bounded**：不使用 `Math.random`；物件池重用（`alive` 旗標覆寫既有槽位），不逐幀配置新物件。
- **Testable**：`tests/unit/projectiles.test.ts` 覆蓋：打牆消滅、打玩家造成傷害、打敵人造成傷害且回報 `died`、超時消滅、物件池重用（spawn 次數大於同時存活數時陣列不無限增長）。

## AC-4 射擊體 Spitter（src/game/spitter.ts、src/procgen/mesh/spitter.ts）

- **Observable**：HP 45、速度 3.0、投射傷害 8 每 1.5 秒、投射速度約 12 m/s；FSM `idle → detect → reposition → windup(0.4s) → shoot → reposition`（`hurt`／`dead` 為插入態，同 Crawler 慣例由 `applyDamage()` 直接指定）；reposition 維持與玩家 6–10m 距離、近身時後退、windup 時橘光增強（telegraph）。
- **Measurable**：命中判定 `SPITTER_HALF = { x:0.32, y:0.95, z:0.38 }`；網格剪影與巡行體一眼可分（較高瘦、頭部發光橘色砲口）；視覺不超出命中包絡（水平半徑 ≤ `min(half.x, half.z) + AIM_ASSIST_MARGIN`）。
- **Bounded**：不用 `Math.random`（漂移用 id＋累計時間的 `sin`，同 Crawler 慣例）；`game/spitter.ts` 不 import `procgen/mesh`（邏輯層與外觀層解耦，同 Crawler 慣例）。
- **Testable**：`tests/unit/spitter-fsm.test.ts`（轉移表決定性、數值鎖定、windup 觸發 shoot 事件、hurt/dead）；`tests/unit/spitter-mesh.test.ts`（決定性、非空、頂點可整除、警示橘存在、站立高度 1.9±0.1m、命中包絡不變量）。

## AC-5 渲染與音效整合

- **Observable**：`gfx/renderer.ts` 的敵人渲染管線支援多種網格（crawler／spitter 各自 VAO，`EnemyInstance.mesh` 鍵值選取）；`hitFlash`／`dissolve` 沿用；新增 `telegraph` uniform 供 windup 橘光增強。合成器新增 spitter 發射聲、windup 聲、控制台確認音。
- **Measurable**：`npm run gate` 全綠（含 typecheck，Renderer 介面變更需編譯通過）。
- **Bounded**：不新增素材檔；不影響既有 crawler 渲染與命中回饋行為（既有 combat/m2-level Playwright 規格全綠）。
- **Testable**：`npm run gate`；截圖人工檢視（見下方驗收指令）。

## AC-6 容量閘門

- **Observable**：`budget.json` 改為 `{ "current": "M3", "limitBytes": 2097152 }`。
- **Measurable**：`npm run size:check` 通過（brotli 總量 ≤ 2MB）。
- **Bounded**：不為壓容量犧牲本階段功能完整性（PLAN §7.2 M3 為「開始有感控管」而非發行硬限）。
- **Testable**：`npm run size:check` 輸出 PASS，回報實際 brotli 總量。

## AC-7 測試（納入 gate）

- **Observable／Testable**：`npm run gate` 全綠，含：
  - unit：spitter FSM 與數值鎖定、投射物掃掠命中（牆／玩家／敵人／超時）、控制台互動狀態、關卡決定性與新 golden、spitter 網格決定性與包絡不變量。
  - Playwright：通關劇本延伸到區域 D（`activateConsole()`、`door-d` 開、新 `endTrigger` 通關）；「spitter 會打傷玩家」劇本（teleport 至 D 區 LOS 內站定，等待 HP 下降）；既有 spec（smoke／combat／m2-level／state-settings／music）全數相容修正並通過。

## 驗收指令（全部須實際執行且通過）

```
npm run gate
```

## 已知邊界（本階段不做，非缺陷）

- 電漿步槍（player 陣營投射物實際呼叫端）與能量砲、守衛體、首領戰、無障礙選項為 M3 後續階段範圍，本階段只搭好 `ProjectileSystem` 通用介面。
- 區域 D 高度沿用區域 C 的 7m 牆高（`H_TALL`），未另開專屬樓層高度常數，降低結構複雜度與回歸風險。

---

## 驗收結果（實際執行）

`npm run gate` 全綠：check:assets／check:deps／typecheck／build／size:check／163 條 unit／12 條 Playwright（chromium 全套＋webkit／firefox smoke）全數通過。

- **levelHash**：`6ab98983`（`tests/golden/level-hash.txt`，已更新，涵蓋區域 D 全部新資料：牆面、平台、控制台碰撞體、door-d、射擊體出生點）。
- **容量**：brotli 總量 24982 bytes（上限 2097152 bytes，M3 階段），遠低於上限。
- **AC-1 關卡擴建**：`level.doors.length === 4`（A／B／C／D）；`spitterSpawns.length === 3`；平台為純碰撞（`addSolid`，玩家與射擊體皆無法站上，僅可繞行）。
- **AC-2 控制台互動**：`tests/unit/console.test.ts` 5 條全綠；Playwright `m3-level.spec.ts` (b) 驗證真實 E 鍵輸入路徑（非 debug 後門）可啟動並解鎖 door-d。
- **AC-3 投射物系統**：`tests/unit/projectiles.test.ts` 8 條全綠，涵蓋打牆／打玩家／打敵人／先命中者算／超時／物件池重用／多發並存。
- **AC-4 射擊體**：`tests/unit/spitter-fsm.test.ts` 14 條、`tests/unit/spitter-mesh.test.ts` 8 條全綠。Playwright `m3-level.spec.ts` (a) 實測射擊體在 4.2 秒內對站立不動的玩家造成傷害。
- **AC-5 渲染與音效**：typecheck 綠（Renderer 介面變更含 `EnemyInstance.mesh`／`uTelegraph` 已編譯通過）；`npm run gate` 全綠代表 crawler 既有渲染與命中回饋行為未受影響。
- **AC-6 容量閘門**：`budget.json` 已改 `{"current":"M3","limitBytes":2097152}`，`size:check` 通過。
- **AC-7 測試**：`tests/playwright/m2-level.spec.ts` 通關劇本已延伸至區域 D（door-c 更名、經 `activateConsole()`、door-d 解鎖、新 endTrigger 通關）；既有 smoke／combat／state-settings／music spec 全數相容通過。

### 實作中發現並修正的問題（過程記錄，非交付缺陷）

1. **射擊體出生座標與平台碰撞體重疊**：初版 spitterSpawns 的 z 座標（-11.7／-8.3）與平台邊界（z=-12／z=-8）僅差 0.08m，實際重疊導致移動解算卡死（射擊體永遠無法後退拉開到最小距離，因而永遠打不到玩家）。由 Playwright「射擊體會打傷玩家」測試 10 秒逾時發現，改為留 0.6m 以上淨空後修正（z: -11.0／-9.0）。
2. **驗收截圖凍結時機**：`clearArea` 清空敵人後，死亡溶解動畫需 1.2 秒才真正消失；若凍結截圖前只等待遠短於此的時間，畫面會停在「近乎不透明的死亡中間幀」而非真正清空，已在截圖流程中改為等滿 1.5 秒。

## 截圖（驗收用，落檔絕對路徑）

- `/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/m3-area-d.png`
- `/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/m3-spitter.png`
- `/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/m3-console.png`

人工檢視結論：射擊體剪影（瘦長三足、頭部發光橘色砲口）與巡行體（矮壯人形、雙臂前伸、胸口警示橘）一眼可分；控制台的階梯狀操作面與「按 E 啟動控制台」HUD 提示清楚可讀；區域 D 的平台邊緣、控制台與 door-d 可於同一視角辨識。
