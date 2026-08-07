# fps-lin（PROJECT 96）

純瀏覽器單人 FPS：開網址即玩，無帳號、無後端、無下載。所有材質、模型、關卡、音效、音樂都在載入時由固定種子**程序化生成**，repo 內零素材檔（無任何 png／wav／glb，CI 強制檢查）。黑暗科幻加生物機械風格，單一線性關卡，brotli 壓縮後傳輸量約 33KB。

**線上試玩**：https://fps-lin.netlify.app （需鍵盤與滑鼠，不支援行動裝置）

## 兩條靈魂鐵則

1. **資產零素材檔**：所有可見可聽的內容都來自程式與參數，`check:assets` 守門；runtime `dependencies` 永遠為空。
2. **影響玩法的生成一律 CPU 決定性**：關卡佈局、碰撞、敵人配置以固定種子在 CPU 生成，跨機器逐位元一致（golden level hash 驗證）；只影響外觀的生成才允許上 GPU。

## 遊戲內容（M3 完成態）

- **流程**：甦醒室 → 維修走廊 → 熔爐大廳 → 控制區 → 核心通道 → 前廳 → 首領戰 → 真結局，首次通關約 15 至 30 分鐘。
- **武器四把**：脈衝手槍（hitscan）、散射槍、電漿步槍（投射物）、能量砲（充能濺射）。
- **敵人**：巡行體、射擊體、守衛體（正面減傷、背部弱點）、首領「核心守護者」（三模式彈幕／召喚／震波，血量門檻加壓）。
- **系統**：條件滑門、自動撿取、程序化合成音樂（戰鬥觸發）、設定選單（靈敏度、音量、FOV、按鍵重設，localStorage）、無障礙稽核（色彩加形狀辨識）。

## 技術棧

TypeScript ＋ 原生 WebGL，零 runtime 依賴。開發工具僅 esbuild、TypeScript、Playwright。程序化生成涵蓋 mesh（`src/procgen/mesh/`）、材質（`src/procgen/texture/`）、關卡（`src/procgen/level/`）與音訊合成（`src/audio/synth.ts`、`music.ts`）。

## 專案結構

```
src/
  core/       # 主迴圈、輸入、數學、設定
  game/       # 玩家、武器、敵人 FSM、首領、碰撞、門、狀態機
  gfx/        # WebGL 封裝與 renderer
  procgen/    # mesh / texture / level 程序化生成
  audio/      # 合成器與程序化音樂
  ui/         # HUD、選單、overlay、按鍵顯示
  rng/        # 決定性亂數
scripts/      # dev / build / size / check-assets / check-deps
tests/        # unit（node --test）、playwright、golden level hash
PLAN.md       # 完整計畫書暨規格表
HANDOFF.md    # 交接文件（現況、慣例、待辦）
```

## 開發

需 Node ≥ 20。

```bash
npm install
npm run dev          # 開發伺服器（port 8330）
npm run build        # esbuild 產出 dist/
npm run gate         # 統一驗證入口：assets → deps → typecheck → build → size → test
```

`gate` 為唯一驗收入口：275 條 unit test ＋ 20 條 Playwright、容量預算檢查（`budget.json`）、零素材與零依賴守門。部署走 Netlify（`netlify deploy --dir dist`）。

## 路線圖與狀態

M0 骨架 → M1 概念驗證 → M2 垂直切片 → **M3 完整內容（已完成）** → M4 容量效能優化 → M5 發行候選 → M6 壓縮挑戰版（256KB／96KB，選配）。目前待外部測試者無解說通關後收關 M3；容量已遠低於 1MB 目標。詳見 `PLAN.md` 與 `HANDOFF.md`。
