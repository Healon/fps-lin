# AC：M3 第四階段（收官：無障礙選項——按鍵重設、螢幕晃動稽核、色彩加形狀提示稽核）

> 派工來源：主對話。基準 main（e110eda，含已委託的 M3 phase 1／phase 2／phase 3）。working tree
> 於派工當下乾淨。High-Risk：否。不 commit／push／部署／刪專案外檔案／kill 非自己啟動的行程。
> 不改 PLAN.md、HANDOFF.md。

## AC-1 按鍵重設（src/core/settings.ts、src/core/input.ts、src/ui/menu.ts、src/ui/overlay.ts）

- **Observable**：可重設六個動作——前進、後退、左移、右移、射擊（預設空白鍵）、互動（預設 E）。
  方向鍵視角、數字鍵 1234 切換武器、Esc 暫停固定不可重設，設定面板內明示（`keySectionNote`
  文字：「方向鍵視角、數字鍵 1234 切換武器、Esc 暫停為固定按鍵，不可重設。」）。InputManager
  改為讀取 `KeyBindings` 映射（`core/settings.ts` 管理），不再硬編 switch case。設定面板新增
  「按鍵設定」區：六列各顯示動作名與目前鍵名（`keyCodeDisplayName` 將 code 轉顯示名，如
  `Space`→「空白鍵」），點「重新綁定」進入「請按下新按鍵…（Esc 取消）」擷取態，擷取到的鍵若與
  其他動作衝突則兩者互換；附「恢復預設按鍵」按鈕。主選單操控提示改為依目前綁定動態生成
  （`Overlay.updateControlsHint`）。
- **Measurable**：`localStorage` key 命名空間 `p96.settings.keys.{forward,back,left,right,fire,interact}`；
  `DEFAULT_KEY_BINDINGS` 與舊硬編值一致（`forward:"KeyW"`、`back:"KeyS"`、`left:"KeyA"`、
  `right:"KeyD"`、`fire:"Space"`、`interact:"KeyE"`），故不重綁時行為逐位元不變（既有 spec 免修）。
- **Bounded**：載入時驗證——格式不合法（非英數字／空字串／長度逾 32／為保留碼 `RESERVED_KEY_CODES`
  即方向鍵四顆、`Digit1`~`Digit4`、`Escape`）該欄回退預設值；六項之間出現重複綁定（同一 code
  綁給兩個動作）視為整組不變量，無法歸咎單一欄位，一律整組回退預設（`loadKeyBindings`）。
  `KeyBindingStore.setBinding` 對保留碼直接拒絕（回傳 `null`，不變更任何綁定）；`InputManager.setBindings`
  同時歸零六個動作目前的按下狀態，避免舊映射鍵按住未放開換了映射後卡在 `true`。
- **Testable**：`tests/unit/settings.test.ts` 新增 12 條（載入預設、讀回一致、格式不合法回退、
  保留碼回退、整組重複回退、`KeyBindingStore` 建構載入、`setBinding` 無衝突／有衝突互換／
  保留碼拒絕、`resetToDefault`、`onChange` 通知、`KEY_BINDABLE_ACTIONS` 完整性）；
  `tests/playwright/state-settings.spec.ts` 新增 (d)：Esc 取消不變更、衝突互換、重綁射擊鍵為
  `KeyF` 後真實按鍵路徑（`page.keyboard.down/up`，非 `debug.fire()`）驗證新鍵能開火（彈藥減少）、
  舊鍵（`Space`）不再觸發、reload 後 `debug.getKeyBindings()` 與 `localStorage` 皆持久化。

## AC-2 螢幕晃動開關（稽核結論：不適用，不做空選項）

- **稽核方法**：全 repo 搜尋 `shake`／`Shake`／`jitter`／`Jitter`／`perturb`／`wobble`／
  camera offset 相關字樣（`src/game/*.ts`、`src/gfx/*.ts`、`src/main.ts`），並逐一追蹤首領
  震波（`boss.ts` shockwave-telegraph／detonate）、能量砲充能、受傷回饋的視覺實作。
- **稽核結果**：本作**無任何相機晃動或畫面震動效果**。受傷回饋是螢幕邊緣紅色暈影
  （`hud.setHurtFlash`，`hud.ts` 的 `hurtVignetteEl`）；首領震波 telegraph 是全螢幕紅光疊圖
  （`hud.setBossShockwaveTelegraph`）加低鳴音效（`playBossShockwaveTelegraph`），兩者皆不移動
  相機或視角；後座力（`Recoil` 類別，`game/effects.ts`）只位移第一人稱 viewmodel（槍枝模型
  在畫面右下角的偏移），不影響玩家相機的 yaw／pitch／位置。三者皆不構成「螢幕晃動」。
- **結論**：選項不適用，本階段不新增「關螢幕晃動」開關（PLAN §9 M3 條目提及此項，但功能
  本身不存在時做一個空的假開關會誤導使用者「這遊戲有晃動」，故誠實記錄取代湊數）。
- **Testable**：本 AC 不涉及程式變更，無新增測試；稽核過程與結論即為驗收證據（見上）。

## AC-3 色彩加形狀提示稽核（PLAN §5.1 紅線：色彩提示不只依賴顏色）

逐項稽核「只靠顏色區分」的資訊，結果如下（皆為稽核，未發現缺口，故無程式異動）：

- **彈藥盒與醫療包**：`src/procgen/mesh/pickup-props.ts` 既有實作已達標——彈藥盒為單一能源青
  實心箱體（無額外形狀特徵）；醫療包為深色箱體正面浮凸一枚治療綠十字（兩道交疊細長箱體，
  `generateMedkitBoxMesh`），色彩（青 vs 綠）與形狀（無特徵 vs 十字）雙通道皆有差異。實測截圖
  `m3-shapes.png`（見下方 AC-4）清楚可見兩者同框差異。另外拾取時的 HUD toast 亦為文字提示
  （「拾取彈藥 +N」／「生命 +N」，見 `main.ts` `collectPickup`），非純色彩依賴。
- **三種敵人剪影**：`crawler.ts`（矮壯殭屍人形，雙臂前伸，約 1.7m）、`spitter.ts`（瘦高三足，
  約 1.9m，頭部發光橘砲口）、`warden.ts`（寬體厚重機甲，約 2.0m，正面大塊裝甲板背面警示橘）
  三者剪影已在既有實作明確分化（各檔頭註解與 `tests/unit/*-mesh.test.ts` 皆有剪影差異斷言，
  如 warden-mesh.test.ts 的「剪影與另兩種敵人明顯不同」）。稽核確認，無需修正。
- **門的鎖定與解鎖狀態**：`game/doors.ts` 的 `LOCKED_HINT_TEXT` 提供文字提示（如「偵測到生命
  跡象，門鎖定中」，實測截圖 `m3-shapes.png` 背景可見），經 `hud.setHint()` 顯示，非純色彩依賴
  （門本身開闔以物理滑動位置變化呈現，非僅色彩）。稽核確認，無需修正。
- **首領震波 telegraph**：紅光疊圖（視覺）加低鳴音效 `playBossShockwaveTelegraph()`（聽覺，
  即第二通道），聲音先於視覺全紅提供預警。稽核確認，音訊已是獨立於顏色的第二通道，無需修正。
- **結論**：四項稽核皆確認既有實作已符合「色彩提示不只依賴顏色」原則，無缺口，無程式修正。

## AC-4 render-first 驗收

兩張截圖存
`/private/tmp/claude-501/-Volumes-MAC-SSD-dev-Projects-fps-lin/1bad7082-7f35-4ec0-812f-f39f3c448581/scratchpad/`：

- `m3-keybind.png`：主選單「設定」面板，含完整「按鍵設定」六列（前進 W／後退 S／左移 A／
  右移 D／射擊 F／互動 E）與「恢復預設按鍵」「返回」按鈕；射擊列示範已重綁為 `KeyF`（重新綁定
  按鈕呈按下態的青色外框，顯示重綁操作剛完成）。已人工讀圖確認：六列與固定按鍵說明文字皆清楚
  可讀，版面在 1280×800 視窗內完整顯示不需捲動。
- `m3-shapes.png`：區域 F 前廳，彈藥盒（左，實心能源青箱體）與醫療包（右，深色箱體加亮綠色
  十字）同框，中景可見門鎖定文字提示「偵測到生命跡象，門鎖定中」與能量砲台座剪影。已人工讀圖
  確認：兩者色彩與形狀差異清楚可辨，十字符號清晰可見，非純色彩區分。

---

## 驗收結果（實際執行）

`npm run gate` 全綠：check:assets／check:deps／typecheck／build／size:check／**275 條 unit**
（原 263＋新增 12）／**20 條 Playwright**（原 19＋新增 1，chromium 全套＋webkit／firefox smoke）
全數通過。

- **levelHash**：`d2e9e052`（`tests/golden/level-hash.txt`，**未變動**——本階段未觸碰任何
  procgen／level 生成邏輯或既有 mesh 幾何，`git status --short tests/golden/level-hash.txt`
  確認零差異）。
- **容量**：brotli 總量 **32,786 bytes**（上限 2,097,152 bytes，M3 階段），遠低於上限，距 M4
  的 1MB 目標仍有充裕餘量（較 M3 phase 3 的 31,336 bytes 僅增加約 1,450 bytes）。
- **AC-1 按鍵重設**：`settings.test.ts` 新增 12 條全綠（載入驗證、衝突互換、保留碼拒絕、
  `onChange` 通知等）；`state-settings.spec.ts` (d) 全綠，實測：Esc 取消擷取後綁定與顯示皆
  還原、互動與右移重綁 `KeyD` 觸發正確互換（`interact→KeyD`、`right→KeyE`）、射擊重綁 `KeyF`
  後真實按鍵路徑（非 debug 後門）觸發開火使彈藥減少、原空白鍵重綁後按住不再觸發開火、reload
  後 `debug.getKeyBindings()` 三項綁定（`fire`／`interact`／`right`）皆與 `localStorage` 一致、
  主選單操控提示同步反映新綁定（`menu-controls-hint` 含「F：射擊」「D：互動」）。全程零
  console error／pageerror。
- **AC-2 螢幕晃動**：稽核確認本作無相機晃動效果，選項不適用，誠實記錄取代湊數（見上方 AC-2）。
- **AC-3 色彩加形狀提示**：四項逐一稽核（彈藥盒／醫療包、三種敵人剪影、門鎖定狀態、首領震波）
  皆確認既有實作已達標，無缺口，無程式修正（見上方 AC-3 逐項說明）。
- **AC-4 render-first**：兩張截圖已產生並人工讀圖確認：按鍵設定面板六列清楚可讀且版面完整；
  彈藥盒與醫療包同框，色彩（青 vs 深色）與形狀（無特徵 vs 綠十字）雙通道差異清晰可辨。

### 開發過程中的重要發現（非交付缺陷，記錄供日後參考）

- 首次嘗試 `m3-shapes.png` 截圖時，玩家座標（x:99）誤置於區域 F 前廳範圍（`X:[86,98]`）之外
  （超出邊界 1 公尺），導致相機貼近牆體幾何造成近裁面巨大特寫、畫面完全失焦。修正為區域內
  座標（x:97）後正確取景。此為截圖腳本的一次性座標誤判，非遊戲本身缺陷，記錄避免日後重蹈。
- `InputManager` 的按鍵擷取（設定面板「請按下新按鍵」）改用 `capture: true` 階段監聽
  `window` 的下一次 `keydown` 並 `stopPropagation()`，確保先於 `InputManager` 本身的
  （bubbling 階段）監聽器攔截同一次按鍵事件，避免使用者在設定畫面按下移動／射擊鍵時同時被
  誤判為真實遊玩輸入（雖然設定畫面開啟時 `gameState` 必為 `menu`／`paused`，模擬本就不消費
  `input.state`，此為保守防呆，避免鍵按住未放開造成 `InputManager` 內部旗標卡在 `true`）。
