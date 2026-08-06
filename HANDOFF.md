# HANDOFF：fps-lin（PROJECT 96）交接文件

> 更新：2026-08-05（M3 完整內容開發完成）。本檔隨 git 同步，換機或換 session 先讀這裡，再讀 PLAN.md。

## 現在在哪裡

- **main 分支（唯一分支）**：M3 開發全數完成。正式站 https://fps-lin.netlify.app 是**完整遊戲**：開場文字 → 區域 A 至 F → 首領戰 → 真結局。
- 里程碑 commit：M0＝fbdf219、M1＝bdcecdb、M2＝0cefa4b／6350732／2e6dd08、M3＝bfda9f0／b187d33／e110eda 加收官（無障礙）commit。
- GitHub：Healon/fps-lin（public）。Netlify site：fps-lin（slug siching-lin，本機已登入 CLI）。

## 遊戲現況（M3 完成態）

- 流程：甦醒室（撿手槍）→ 維修走廊（巡行體）→ 熔爐大廳（散射槍伏擊）→ 控制區（E 鍵控制台、射擊體）→ 核心通道（守衛體混編、電漿步槍）→ F 前廳（能量砲）→ 首領戰（核心守護者）→ 真結局。
- 武器四把：脈衝手槍（hitscan）、散射槍（6 珠）、電漿步槍（投射物）、能量砲（充能 1.2 秒、80 傷濺射、彈藥 12）。數字鍵 1 至 4。
- 敵人：巡行體（24 血殭屍人形、遊走後撤）、射擊體（45 血遠程、蓄力投射）、守衛體（160 血、正面減傷、背部橘弱點、衝撞）、首領核心守護者（**450 血**，三模式：扇形彈幕、召喚上限 4、震波掩體無視線免傷；HP 60%／30% 加壓）。
- 系統：三態加 complete 狀態機、條件滑門、自動撿取、單向戰鬥音樂（觸發後持續整場，restart 重置）、投射物彈體生成後漸長、設定（靈敏度、音量、FOV、**按鍵重設六動作**，localStorage）。
- 無障礙稽核（AC_m3-phase4）：無相機晃動效果故無開關（誠實記載）；色彩加形狀四項合規。

## 驗證與慣例

- 統一入口：`npm run gate`。現況 **275 條 unit、20 條 Playwright**（smoke ×3 引擎；combat、m2-level、m3-level、m3-boss、state-settings、music 為 chromium）。brotli 約 32.8KB（M3 上限 2MB）。
- levelHash golden：`d2e9e052`。涵蓋全部玩法資料；戰鬥常數（血量等）不入 hash。
- 埠：dev 8330、測試 8331／8332。kill 前 `ps -o command=` 驗身分；本機 3000／8000／5432 屬 NursingFlow production。
- 部署：draft `netlify deploy --dir dist --no-build --site fps-lin`；`--prod` 對應 main。
- debug hooks（`window.__p96`，參數一律物件）：levelHash、frames、gameState、ammo()、currentWeapon()、kills()、enemiesAlive()、spittersAlive()、playerHp()、fire()、aimAt(i 索引存活清單)、damagePlayer(n)、bossAlive()；debug.*：setState、grantWeapon、clearArea('B'|'C'|'D'|'E')、doorState('door-a'…'door-e')、teleportPlayer、lookAt、enemyTransforms()、pickupsRemaining()、musicState()、maxFrameMs()、activateConsole()、setBossHp、getKeyBindings()、forceComplete、setFreezeFx。注意：**無 bossHp 讀取 hook**（只有 setBossHp），需要時再補。
- 鐵則：repo 零素材檔、dependencies 永遠為空、玩法生成純 CPU 決定性、視覺輪廓不得超出命中包絡（不變量測試）、render-first（效果類驗收必須連拍抓到像素證據）。

## 待辦與已知事項

1. **外部測試 3 至 5 人無解說通關（M3 最後一條 AC，Lin 負責找人）**：記錄卡點、看不懂、不好玩三類，回饋丟給主對話逐條處理，完成後 M3 正式收關。
2. M4 容量效能輪：容量已提前達標（32.8KB 對 1MB），剩實機效能驗證（1080p 60fps、內顯品質設定）與相容矩陣實測；PLAN 的 rollup 加 terser 產線建置與材質分幀化（約 89ms）可在此輪一併裁決做不做。
3. M5 發行候選：正式名稱（不可用 .kkrieger）、LICENSE、credits、§1.5 成功標準逐條總對帳、itch.io 上架裁決。
4. 技術債：box.ts 前後面繞序與宣告法線相反（已掛獨立任務卡片，warden 局部繞過中）；跨機 levelHash 一致性未實測（MBP 開專案時對 golden 驗一次）。
5. `.claude/worktrees/` 已 gitignore（本機 session 殘留快照，勿入庫）。

## 換機器怎麼接

```
cd ~/Projects && gh repo clone Healon/fps-lin && cd fps-lin
npm install
npm run gate
```

全綠即就緒（三引擎 smoke 首次需 `npx playwright install webkit firefox`）。dev：`npm run dev`（埠 8330）。決策脈絡：PLAN §2（D-001 至 D-005）與各節版本註記、各 AC_*.md 檔。
