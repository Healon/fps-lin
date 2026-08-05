# AC：M3 第二階段（區域 E 核心通道、守衛體、電漿步槍）

> 派工來源：主對話。基準 main（M3 第一階段已合併：feat: M3 phase 1 - area D, spitter, projectile system, interact key）。
> High-Risk：否。不 commit／push／部署／刪專案外檔案／kill 非自己啟動的行程。不改 PLAN.md、HANDOFF.md。

## AC-1 關卡擴建：區域 E（src/procgen/level/level.ts）

- **Observable**：door-d 之後的終點小空間改建為區域 E 核心通道（約 24×6m，X:[62,86] Z:[-13,-7]，牆高 5m），兩側交錯凹龕與柱體（北凹龕 x:[66,69] → 柱體 x=72 → 南凹龕 x:[75,78] → 柱體 x=81）；電漿步槍台座位於前段（x=65）；`door-e`（條件 `area-clear:E`）通往新終點小室（X:[86,90]）與新 `endTrigger`。
- **Measurable**：`generateLevel().doors.length === 5`（A/B/C/D/E）；`spitterSpawns.length === 5`（D 的 3 加 E 的 2）；`wardenSpawns.length === 1`；`enemySpawns` 區域 E 恰 4 隻；`pickups` 含 `weapon-plasma` ×1、`ammo-plasma` ×2；levelHash 涵蓋全部新增資料。
- **Bounded**：不用 `Math.random`／`Date`；沿用既有 `addSolid`／`addFloorCeiling`／`aabbFromCenterHalf` 慣例；不改區域 A–D 既有座標（區域 D 東牆與 door-d 門楣完全不動，區域 E 直接銜接該既有邊界，不重複建牆）。
- **Testable**：`tests/unit/level.test.ts` 更新斷言門數／敵人數／守衛體數／撿取物種類；golden `tests/golden/level-hash.txt` 更新為新值。

## AC-2 守衛體 Warden（src/game/warden.ts、src/procgen/mesh/warden.ts）

- **Observable**：HP 160、速度 1.8、FSM `idle → detect → advance（緩慢逼近，漂移幅度約 ±12 度，明顯小於 Crawler 的 ±35 度）→ windup（0.5 秒蓄力，距離 4～7m 且有 LOS 時觸發）→ charge（鎖定方向直線衝撞，6 m/s，1 秒，命中玩家 25 傷加 1.2m 短暫擊退，命中後提前結束回 advance）→ attack（近戰 25、間隔 1.2 秒）→ hurt（硬直 0.15 秒，較 Crawler/Spitter 短，重甲感）→ dead`；衝撞冷卻 4 秒（進入 windup 當下鎖定）。
- **Measurable**：`WARDEN_HALF = {x:0.6, y:1.0, z:0.55}`（寬體，水平半徑明顯大於 Crawler／Spitter）；方向性減傷 `applyDamage(amount, hitDirection?)`——命中方向與面向夾角 < 60 度（正面弧）傷害減半，其餘（含未提供方向，如 debug 一擊必殺）全額；`isFrontHit()` 為純函式，單元測試逐條鎖定 59/60/61 度角邊界。
- **Bounded**：不用 `Math.random`（漂移用 id 相位加模擬累計時間，同 Crawler／Spitter 慣例）；`game/warden.ts` 不 import `procgen/mesh`（邏輯層與外觀層解耦）。
- **Testable**：`tests/unit/warden-fsm.test.ts`（轉移表決定性、數值鎖定、charge 觸發與冷卻、方向性減傷角度邊界、擊退向量、hurt/dead）；`tests/unit/warden-mesh.test.ts`（決定性、非空、頂點可整除、命中包絡不變量、剪影明顯寬於另兩種敵人、正面／背面配色）。

### 渲染修正記錄（過程發現，非交付缺陷）

render-first 驗收截圖時發現：`procgen/mesh/box.ts` 的 `appendColoredBox`／`appendBox` 產生的 `nz`／`pz` 四邊形，其實際三角形繞序（GL 剔除依據）與宣告的 `normal` 欄位方向相反——以「精確站在 `forwardFromYawPitch(yaw,0)` 所指方向」的相機位置實測確認：站在守衛體面向的方向，實際看到的是 `pz` 面而非宣告 `normal=[0,0,-1]` 的 `nz` 面。此為 `box.ts` 既有的一貫特性（非本次新增，`crawler.ts` 等既有網格可能同樣受影響但不在本次派工範圍，已在 `warden.ts` 註解記錄供日後追查，不在本階段修改共用 `box.ts` 或其他敵人檔案，避免影響已驗收內容）。已在 `warden.ts` 內對應調整色彩鍵值指派（`nz: WARNING_COLOR, pz: ARMOR_COLOR`）以達成設計意圖（正面看到深色裝甲板、繞背看到警示橘），並同步修正 `warden-mesh.test.ts` 的斷言與註解說明。方向性減傷的遊戲邏輯（`isFrontHit`）純為座標數學，不受此渲染細節影響，未受牽連。

## AC-3 電漿步槍（src/game/plasma.ts、src/procgen/mesh/plasma-rifle.ts）

- **Observable**：投射物 20 m/s、單發傷害 14、射速 6 發/秒（按住連射，射速由冷卻限制）、彈藥上限 180；經 `ProjectileSystem` 發射 player 陣營投射物（能源青 `#35E0FF`、radius 0.12）；命中敵人（含守衛體，走方向性減傷介面）。viewmodel 比散射槍長、帶能源青發光條；數字鍵 3 切換；HUD 名稱「電漿步槍」；彈藥 pickup toast。
- **Measurable**：`PlasmaRifle.tryFire()` 回傳 `spawnEvent`（含正規化方向），由 main.ts 呼叫 `ProjectileSystem.spawn()`；命中回饋（`hitMarkerActive`）延後至投射物實際命中時觸發（`triggerHitMarker()`），非開火當下。
- **Bounded**：`game/plasma.ts` 不直接 import `ProjectileSystem`（沿用 Spitter「回傳事件、呼叫端建立投射物」解耦慣例）；不新增音訊檔。
- **Testable**：`tests/unit/plasma.test.ts`（射速冷卻、傷害／彈藥常數、spawnEvent 欄位、彈藥耗盡、reset、命中回饋計時器）；`tests/unit/plasma-mesh.test.ts`（決定性、非空、含能源青發光條、長度大於散射槍）。

## AC-4 渲染與音效整合

- **Observable**：`gfx/renderer.ts` 敵人渲染管線新增 `warden` 網格鍵值；`renderViewmodel` 支援 `"plasma"`；合成器新增電漿步槍發射聲、守衛體衝撞蓄力低吼與撞擊聲。
- **Measurable**：`npm run gate` 全綠（含 typecheck）。
- **Bounded**：不新增素材檔；不影響既有 Crawler／Spitter 渲染與命中回饋行為（既有 Playwright spec 全數相容修正並通過）。
- **Testable**：`npm run gate`；截圖人工檢視（見下方）。

## AC-5 容量閘門

- **Observable**：`budget.json` 沿用 `{ "current": "M3", "limitBytes": 2097152 }`（M3 第一階段已設定，本階段未變）。
- **Measurable**：`npm run size:check` 通過，brotli 總量 26879 bytes（遠低於 2MB 上限）。
- **Testable**：`npm run size:check` 輸出 PASS。

## AC-6 測試（納入 gate）

- unit：Warden FSM（含 charge 觸發與冷卻）、方向性減傷角度邊界（59/60/61 度）、Warden 網格包絡不變量與數值鎖定、電漿步槍射速與傷害、電漿步槍網格、關卡決定性與新 golden。
- Playwright：通關劇本延伸過區域 E（`tests/playwright/m2-level.spec.ts` 測試 (a)：走入區域 E → 驗證 enemiesAlive／spittersAlive／wardensAlive 計數 → `clearArea("E")` → door-e 開 → 新 endTrigger 通關）；「正面打守衛體傷害減半」用 `debug.wardenTransforms()` 的 hp 欄位驗（damage 前後 HP 差比較，`tests/playwright/m3-level.spec.ts` 測試 (c)）；電漿步槍數字鍵 3 切換（真實輸入路徑）與投射物命中造成傷害（測試 (d)）；既有 spec（combat／m2-level／m3-level (a)）因區域 E 常駐敵人加入全域計數而相容修正。

## 驗收指令（全部須實際執行且通過）

```
npm run gate
```

## 已知邊界（本階段不做，非缺陷）

- 能量砲與首領戰為 M3 後續階段範圍，本階段只交付電漿步槍作為 player 陣營投射物武器的第一個實際呼叫端（`ProjectileSystem` 通用介面已在第一階段搭好）。
- 無障礙選項（關螢幕晃動、按鍵重設、色彩加形狀提示）為 M3 後續階段範圍。
- `procgen/mesh/box.ts` 的 winding／normal 標籤不一致問題僅在 `warden.ts` 內以色彩鍵值對調處理，未修改共用檔案本身或回頭修正 `crawler.ts`／`spitter.ts`（若它們有相同狀況），刻意留給日後獨立任務評估是否需要根治，避免本階段範圍外變更影響已驗收內容。

---

## 驗收結果（實際執行）

`npm run gate` 全綠：check:assets／check:deps／typecheck／build／size:check／207 條 unit／14 條 Playwright（chromium 全套＋webkit／firefox smoke）全數通過。

- **levelHash**：`73646711`（`tests/golden/level-hash.txt`，已更新，涵蓋區域 E 全部新資料：走廊牆面、凹龕、柱體、door-e、守衛體與射擊體出生點、電漿步槍與彈藥撿取物、新終點觸發區）。
- **容量**：brotli 總量 26879 bytes（上限 2097152 bytes，M3 階段），遠低於上限。
- **AC-1 關卡擴建**：`doors.length===5`、`spitterSpawns.length===5`（D:3+E:2）、`wardenSpawns.length===1`、區域 E 巡行體 4 隻，皆通過。
- **AC-2 守衛體**：`warden-fsm.test.ts` 21 條、`warden-mesh.test.ts` 8 條全綠；方向性減傷以 Playwright 真實武器開火路徑驗證（測試 (c)：正面命中脈衝手槍 12 傷 → 實測扣減 6，逐位元精確符合半額）。
- **AC-3 電漿步槍**：`plasma.test.ts` 7 條、`plasma-mesh.test.ts` 6 條全綠；Playwright 測試 (d) 驗證數字鍵 3 真實輸入切換與彈藥遞減。
- **AC-4 渲染與音效**：typecheck 綠；`npm run gate` 全綠代表既有 Crawler／Spitter 渲染與命中回饋行為未受影響。
- **AC-5 容量閘門**：`size:check` 通過。
- **AC-6 測試**：`m2-level.spec.ts` 通關劇本已延伸至區域 E（`wardensAlive()`、`clearArea("E")`、door-e 開、新 endTrigger 通關，擊殺數 ≥16）；`combat.spec.ts`／`m2-level.spec.ts`／`m3-level.spec.ts` (a) 因區域 E 常駐敵人計入全域計數已相容修正並通過。

### 實作中發現並修正的問題（過程記錄，非交付缺陷）

1. **`box.ts` 的 winding／normal 標籤不一致**：見上方 AC-2 渲染修正記錄。以精確相機定位（站在 `forwardFromYawPitch(facingYaw,0)` 方向）逐步排除 AI 狀態時序、鄰近撿取物遮蔽等干擾後才定位成因，屬 `render-first` 驗收精神的直接體現（若只看「頂點資料測試全綠」會完全錯過此問題，因為該測試檢查的是本地座標而非實際渲染可見性）。
2. **區域 E 常駐敵人使全域計數 debug hook 的既有測試假設失準**：`enemiesAlive()`／`spittersAlive()` 為全域計數（非分區），區域 E 的 4 隻巡行體與 2 隻射擊體自出生即常駐存活，導致 `combat.spec.ts`／`m2-level.spec.ts` 原本鎖定的固定數字（3、6、3）需要加上偏移量或改為分區篩選（新增 `enemyTransforms()` 的 `area` 欄位）才能正確表達測試意圖。

## 截圖（驗收用，落檔絕對路徑）

- `/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/m3-area-e.png`（區域 E 通道廣角：凹龕、柱體、混編敵人一次入鏡）
- `/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/m3-warden-front.png`（守衛體正面：深色裝甲板，無警示橘）
- `/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/m3-warden-back.png`（守衛體背面：警示橘弱點清楚可見）
- `/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/m3-plasma.png`（電漿步槍 viewmodel 加飛行中的青色彈體，連拍等待彈體飛出槍口約 3.5m 後凍結截圖）

人工檢視結論：區域 E 通道的凹龕與柱體交錯掩體節奏清楚可辨；守衛體正面（深色裝甲板）與背面（警示橘）對比鮮明，弱點視覺教學成立；電漿步槍 viewmodel（修長槍身加能源青發光條）與飛行中的青色能量彈同框可見，與守衛體、射擊體的視覺風格皆可一眼分辨敵我陣營（暖橘＝敵、青＝我方能源科技）。
