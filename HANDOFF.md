# HANDOFF：fps-lin（PROJECT 96）交接文件

> 更新：2026-08-04。本檔隨分支入庫，換機或換 session 先讀這裡，再讀 PLAN.md。

## 現在在哪裡

- **main 分支**：M1 概念驗證已合併（Lin 2026-08-04 指示），含五輪實玩回饋修正。正式站 https://fps-lin.netlify.app 部署此版本。
- **m1 分支**：與 main 同點（fast-forward 合併後保留作里程碑標記）。
- GitHub：Healon/fps-lin（public）。Netlify site：fps-lin（帳號 slug siching-lin，部署用本機已登入的 netlify CLI）。

## M1 內容摘要（相對 M0 的差異）

戰鬥：脈衝手槍（hitscan 12 傷、3 發/秒、彈藥 120）、瞄準寬容 0.18m、巡行體（殭屍人形 1.7m、HP 24 兩發擊殺、速度 2.2、攻擊後後撤 1 至 1.5 秒、追擊帶 ±35 度遊走）、玩家傷害與死亡 3 秒重生、HUD。
手感：第一人稱手槍 viewmodel、後座、槍口閃光、彈道 tracer、命中火花（敵人橘白／牆面暗琥珀）、敵人中彈閃白。
美術：城堡砌石牆、石板地、火光琥珀光帶（微閃爍）、冷暗恐懼氛圍、暗角、天花板。
操控（D-005）：無跳躍。WASD 移動、滑鼠或方向鍵視角、左鍵或空白鍵射擊、Esc 暫停。
音效：WebAudio 全合成（槍聲、命中、敵死、受傷、重生）。

## 驗證與慣例（每輪都要跑）

- 統一入口：`npm run gate`（守門三項 → typecheck → build → size:check → unit → Playwright）。目前 61 條 unit 加 2 條 Playwright 全綠，brotli 約 14.3KB。
- levelHash golden：`1c089a40`（tests/golden/level-hash.txt）。只涵蓋關卡幾何與敵人配置；材質、光照、敵人行為與模型都不入 hash。
- 埠：dev 8330、測試 8331。kill 前先驗行程身分。本機 3000/8000/5432 是別的 production 服務。
- 部署：`netlify deploy --dir dist --no-build --site fps-lin`（draft）；加 `--prod` 才動正式站。
- debug hooks（自動化與截圖用）：`window.__p96`：levelHash、frames、enemiesAlive()、playerHp()、fire()、aimAt(i)（索引「存活清單」）、damagePlayer(n)、debug.setFreezeFx、debug.teleportPlayer、debug.lookAt、debug.enemyTransforms()。
- 鐵則：repo 零素材檔、dependencies 永遠為空、影響玩法的生成純 CPU 決定性（詳 PLAN §6.4、§7.5）。

## 待辦與已知取捨

1. **技術債：M1 後半輪未跑獨立審查**。M1 前半（戰鬥系統）跑過 fresh-context 審查，後半（特效、城堡材質、殭屍化）僅 gate 加截圖加線上煙囪驗證，Lin 指示直接合併。M2 開工前建議補一輪 fbdf219..main 全 diff 的獨立審查。
2. 敵人警示橘只在正面，背對時融進黑暗（刻意取捨，Lin 若回報「跟丟挫折」就在背面補暗橘識別）。
3. 開始畫面底下遊戲邏輯已在跑（M0 起為自動化測試設計），點擊前按空白鍵會真的開槍。M2 做主選單時以三態遊戲狀態機（選單／進行／暫停）收掉。
4. viewmodel 只跟 yaw 不跟 pitch（簡化，視覺可接受）；tracer 起點用視覺槍口、hitscan 仍從眼睛出發（FPS 慣例）。
5. 跨機 levelHash 一致性未實測（需在 MBP 開一次對 golden）。
6. M2 範圍見 PLAN §9：區域 A 至 C、散射槍、撿取、門與觸發、主選單與暫停、GPU render-to-texture 材質管線、音樂第一軌。M2 結尾有「好玩檢核點」。

## 換機器怎麼接

```
cd ~/Projects && gh repo clone Healon/fps-lin && cd fps-lin
npm install
npm run gate
```

全綠即環境就緒。開發起服務：`npm run dev`（埠 8330）。決策脈絡看 PLAN.md §2（D-001 至 D-005）與 §3 至 §5 的 v3／v4 修訂註記。
