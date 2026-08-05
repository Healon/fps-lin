# AC：M3 第三階段（最終章：區域 F 能源核心、首領核心守護者、能量砲、開場文字、真結局）

> 派工來源：主對話。基準 main（b187d33，含已委託的 M3 phase 1／phase 2）。working tree 另有
> PLAN.md 一行修訂（首領震波規格：躲到掩體後無視線即免傷，主對話改的，本階段未再更動）。
> High-Risk：否。不 commit／push／部署／刪專案外檔案／kill 非自己啟動的行程。不改 PLAN.md、HANDOFF.md。

## AC-1 關卡收官：區域 F 前廳與能源核心（src/procgen/level/level.ts）

- **Observable**：door-e 之後改建為兩段：F 前廳（X:[86,98] Z:[-13,-7]，能量砲台座＋彈藥醫療補給站）→ door-f（大門，`condition:"none"` 走近即開）→ 區域 F 能源核心（X:[98,118] Z:[-20,0]，20×20m，高 9m，8 根方柱環狀掩體，能源核心視覺結構緊鄰首領初始平台）。移除 endTrigger 機制：`LevelData` 不再有 `endTrigger` 欄位，改為 `bossPlatforms`（4 至 5 個）與 `energyCorePos`。
- **Measurable**：`generateLevel().doors.length === 6`（含 door-f）；`bossPlatforms.length` 落在 4～5；`pickups` 含 `weapon-cannon` ×1。
- **Bounded**：不用 `Math.random`／`Date`（含 8 根柱體與 5 個平台點的座標公式，皆為純數學運算，決定性天然成立）；「圓形感」以柱體環狀排布達成，不擴充 box.ts 支援旋轉牆體（超出既有建模慣例，見檔內註解說明取捨）。
- **Testable**：`tests/unit/level.test.ts`（門數、平台數與範圍、能源核心緊鄰平台 0、撿取物種類與數量）；levelHash 更新。

## AC-2 首領「核心守護者」（src/game/boss.ts、src/procgen/mesh/boss.ts）

- **Observable**：HP 900，定點加 4～5 平台轉移；三模式固定循環 barrage→summon→shockwave（`attackModeForCycle`），每模式後皆 reposition 一次；HP<60%／<30% 加壓（彈幕發數 8→10→12、發射間隔縮短、平台轉移時長縮短）；震波躲掩體無 LOS 即免傷；受擊無方向減傷；召喚上限 4、召喚物死亡不回血；HUD 頂部血條（名稱「核心守護者」）。
- **Measurable**：`BOSS_MAX_HP===900`；`escalationTier`／`escalationParams` 門檻與參數鎖定；`pickNextPlatformIndex` 決定性且不連續重複；`fanDirections` 對稱涵蓋 50°弧；震波 LOS 判定重用 `hasClearLineOfSight`。
- **Bounded**：`game/boss.ts` 全程禁 `Math.random`／`Date`，僅用建構時取得的單一 `stream('boss.rng')`；不 import `procgen/mesh`。
- **Testable**：`tests/unit/boss-fsm.test.ts`（17 條：模式循環、HP 門檻加壓、平台選點決定性、震波 LOS 免傷、彈幕扇形、召喚上限、applyDamage 全額無方向、死亡序列、完整軌跡決定性）；`tests/unit/boss-mesh.test.ts`（9 條：決定性、非空、~3m 高、命中包絡、警示橘弱點面、能源青環帶、剪影明顯大於其餘三種敵人）。

## AC-3 能量砲（src/game/cannon.ts、src/procgen/mesh/cannon.ts）

- **Observable**：充能式（按住累積 1.2 秒、HUD 充能條；未滿放開＝取消不耗彈；充滿放開發射，速度 16、半徑 0.3、傷害 80、2.5m 濺射範圍全數命中）；彈藥上限 12；數字鍵 4；viewmodel 粗壯厚重，充能發光強度隨充能比例增強（三級離散頂點色，同 console.ts idle／active 換色慣例的延伸）。
- **Measurable**：`CANNON_CHARGE_DURATION===1.2`、`CANNON_DAMAGE===80`、`CANNON_MAGAZINE===12`、`CANNON_SPLASH_RADIUS===2.5`；`ProjectileSystem` 擴充 `splashRadius`／`tag` 欄位（向下相容，既有單體命中路徑逐位元不變）。
- **Bounded**：真實輸入路徑（按住／放開）不可誤走 `performFire()`（會在每個按住幀觸發一次「已充滿」瞬發，見 main.ts 主迴圈註解防呆）；不新增音訊檔。
- **Testable**：`tests/unit/cannon.test.ts`（10 條：充能取消／發射、彈藥為 0 不充能、tryFireFull、reset、命中回饋）；`tests/unit/cannon-mesh.test.ts`（6 條：決定性、非空、三級發光色遞增、比電漿步槍粗壯）；`tests/unit/projectiles.test.ts` 新增 2 條濺射測試。

## AC-4 敘事收尾（src/ui/menu.ts IntroScreen／WinScreen）

- **Observable**：開場文字（三至五行，繁體全形標點，黑底漸入漸出約 4 秒，任意鍵跳過），只在「新局起點」（主選單開始或暫停選單重新開始）顯示，死亡自動重生不重播；真結局取代「垂直切片完成」：首領死亡→核心過載（全場閃白漸強約 2 秒）→ 結局畫面「設施靜默」（三行結尾文字＋通關時間＋擊殺數＋回主選單），狀態機沿用既有 `complete`。
- **Measurable**：`INTRO_LINES.length===4`；`ENDING_LINES.length===3`；`BOSS_DEATH_SEQUENCE_DURATION===2.0`。
- **Bounded**：不新增 `GameState` 值；控制權（`gameState→playing`）延後至 intro 完成才交出，intro 播放期間主迴圈狀態閘天然擋住模擬。
- **Testable**：`tests/playwright/m3-boss.spec.ts` 測試 (a)(e)；既有 spec（combat／m2-level／m3-level／music／state-settings）相容修正（點擊開始後補一次任意鍵跳過 intro）。

## AC-5 測試（納入 gate）

- unit：`boss-fsm.test.ts`（17）、`boss-mesh.test.ts`（9）、`cannon.test.ts`（10）、`cannon-mesh.test.ts`（6）、`energy-core-mesh.test.ts`（6）、`projectiles.test.ts` 新增濺射（2）、`doors.test.ts` 新增 `none` 條件與 `lock()`（4）、`inventory.test.ts` 新增能量砲（2）、`level.test.ts` 更新為區域 F 結構。
- Playwright：`m3-boss.spec.ts` 五條（開場文字、三模式皆觸發、震波 LOS 免傷、能量砲充能式開火、真結局）；`m2-level.spec.ts` 測試 (a) 延伸至區域 F（撿能量砲、door-f 開、跨入首領大廳鎖門、`setBossHp(0)` 通關、真結局內容）；既有 spec 相容修正（intro 跳過鍵）。debug hooks 補型別：`bossAlive()`、`debug.setBossHp()`、`debug.bossTransform()`、`debug.cannonChargeProgress()`、`debug.doorState()` 回傳值擴充 `"locked"`（皆物件參數或純值，同既有慣例）。

## AC-6 render-first 驗收

- 四張截圖存 `/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/`：`m3-boss-arena.png`（大廳廣角，含核心與首領血條與多根柱體）、`m3-boss-barrage.png`（彈幕飛行中，凍結截圖）、`m3-cannon.png`（能量砲充能中 viewmodel，充能條約 55%）、`m3-ending.png`（結局畫面「設施靜默」）。皆已人工讀圖確認（見下方驗收結果）。

---

## 驗收結果（實際執行）

`npm run gate` 全綠：check:assets／check:deps／typecheck／build／size:check／**263 條 unit**／**19 條 Playwright**（chromium 全套＋webkit／firefox smoke）全數通過。

- **levelHash**：`d2e9e052`（`tests/golden/level-hash.txt`，已更新，涵蓋區域 F 全部新資料：前廳、door-f、8 柱體、5 首領平台點、能源核心座標）。
- **容量**：brotli 總量 **31,336 bytes**（上限 2,097,152 bytes，M3 階段），遠低於上限，距 M4 的 1MB 目標仍有充裕餘量。
- **AC-1 關卡收官**：`doors.length===6`（含 door-f，`condition:"none"`）；`bossPlatforms.length` 為 5；`weapon-cannon` 撿取物 1 個；`endTrigger` 已完整移除（型別、生成、main.ts 判斷、level.test.ts 舊斷言皆已改寫）。
- **AC-2 首領**：`boss-fsm.test.ts` 17 條、`boss-mesh.test.ts` 9 條全綠；Playwright 實測三模式（barrage／summon／shockwave-telegraph）皆確實依序觸發，召喚使 `enemiesAlive()` 增加，震波 LOS 免傷規則以精確柱體幾何驗證通過。
- **AC-3 能量砲**：`cannon.test.ts` 10 條、`cannon-mesh.test.ts` 6 條全綠；Playwright 實測真實按住／放開輸入路徑：未滿 1.2 秒不耗彈、充滿耗彈 1 發並造成濺射傷害。
- **AC-4 敘事收尾**：開場文字四行、真結局三行皆實測顯示；`gameState` 於 intro 播放期間維持在呼叫前狀態（控制權未提前交出）；核心過載 2 秒閃白序列後才轉 `complete`。
- **AC-5 測試**：新增 unit 63 條（17+9+10+6+6+2+4+2 加 level.test.ts 既有項更新）、新增 Playwright 5 條（m3-boss.spec.ts）加 m2-level.spec.ts 完整通關劇本延伸；既有 spec 皆相容修正並通過。
- **AC-6 render-first**：四張截圖已產生並人工讀圖：大廳廣角可見「核心守護者」血條與多根方柱掩體排布；彈幕截圖可見兩發橘色彈體飛行中；能量砲截圖可見充能約 55% 的青色充能條與粗壯發光槍身；結局畫面清楚顯示「設施靜默」標題、三行敘事、通關時間與擊殺數、回主選單按鈕。

### 開發過程中的重要發現（非交付缺陷，記錄供日後參考）

**投射物飛行時間造成的傷害歸因延遲**：撰寫「躲在掩體後應免傷」的 Playwright 測試時，初版測試在偵測到 `shockwave-telegraph` 狀態才躲到掩體後，結果仍測得玩家扣血剛好 30（`SHOCKWAVE_DAMAGE`），一度誤判震波 LOS 判定有 bug。以精確幾何離線重算（`hasClearLineOfSight` 搭配柱體 AABB）證實震波本身判定正確，逐幀輪詢玩家 HP 後發現：扣血其實發生在**彈幕發射後的 `reposition` 狀態**，非 `shockwave-telegraph` 當下——因為彈幕投射物速度 10 m/s，命中判定延後至 `ProjectileSystem.update()` 逐幀掃掠到目標，若彈幕在自身狀態尾聲才發射，落彈時首領已進入下一狀態。3 發 10 傷的彈幕巧合累計 30，與震波傷害數字相同，造成誤導。修正：測試改為「首領一啟動就持續躲藏」而非「只在震波前躲」，才是正確涵蓋彈幕與震波兩種傷害來源的驗證方式。此為 render-first 驗收精神的直接體現：時間序列上的「哪個狀態造成傷害」不能只看事後的 HP 快照，需逐幀觀察才能正確歸因。

## 已知邊界（本階段不做，非缺陷）

- 首領受擊音效（`playBossHit`／`playBossDeath`）僅在投射物命中路徑（電漿步槍／能量砲）精確區分；脈衝手槍／散射槍（hitscan）擊中首領時仍播放通用的 `playHit()`／`playEnemyDie()`（武器層與敵人子類型解耦，未特化），首領死亡當下另有 `beginEndingSequence()` 統一播放 `playBossDeath()` 蓋過，實際體驗不受影響。
- 音樂系統未新增首領戰專屬密度層（PLAN 標註「可選：boss 戰加一層密度，不強制」，本階段未實作，`bossFightActive` 已接入既有雙態音樂系統的 aggro 判定，戰鬥層音樂會持續播放）。
- 能量砲濺射傷害無隨距離衰減（PLAN 標註「衰減可選」，本階段採固定傷害簡化實作）。
- 首領死亡後 door-f 不會重新開啟（永久鎖定，`DoorSystem.lock()` 為單向不可逆）；因通關後直接進入結局畫面，玩家無需走回頭路，此設計刻意簡化。
