# HANDOFF：fps-lin（PROJECT 96）交接文件

> 更新：2026-08-05（M2 垂直切片驗收通過）。本檔隨 git 同步，換機或換 session 先讀這裡，再讀 PLAN.md。

## 現在在哪裡

- **main 分支（唯一分支）**：M2 垂直切片完成，Lin 實玩驗收通過（玩法檢核點：方向確認好玩，M3 獲准開建）。正式站 https://fps-lin.netlify.app 部署此版本。
- 里程碑 commit：M0＝fbdf219、M1＝bdcecdb、M2＝三個 phase（0cefa4b 狀態機與設定、6350732 關卡本體、之後為音樂與跨瀏覽器）。
- GitHub：Healon/fps-lin（public）。Netlify site：fps-lin（帳號 slug siching-lin，本機已登入 CLI）。

## M2 內容摘要

- 三態遊戲狀態機（menu／playing／paused）加 complete 通關態；暫停選單；設定系統（靈敏度、音量、FOV，localStorage）。
- 關卡 A 至 C：甦醒室（空手開局、台座撿手槍）→ L 形走廊 → 維修走廊（3 巡行體）→ 區域清空條件門 → 熔爐大廳（挑高、柱體掩體、散射槍伏擊 6 隻）→ 終點門 → 通關畫面（時間與擊殺數）。
- 系統：條件滑門（has-weapon／area-clear 加走近觸發）、自動撿取（彈藥／醫療／武器，上限與 toast）、散射槍（6 珠散佈）與武器切換（數字鍵 1 2）、通關統計。
- 音樂：WebAudio 步進序列器全合成，探索（dark ambient）與戰鬥雙態，aggro 即切換、清空滯後 3 秒淡回；暫停降 30%；經 master volume 統一控制。
- 跨瀏覽器：Playwright smoke 於 chromium、webkit、firefox 三引擎全綠，零引擎特調。

## 驗證與慣例

- 統一入口：`npm run gate`。現況 123 條 unit、10 條 Playwright（smoke ×3 引擎、combat、m2-level ×2、state-settings ×3、music）。brotli 總量見 `npm run size`。
- levelHash golden：`31f07cb9`（涵蓋幾何、碰撞、門、撿取、敵人配置、終點觸發，全玩法資料）。
- 埠：dev 8330、測試 8331／8332。kill 前先 `ps -o command=` 驗身分；本機 3000／8000／5432 屬 NursingFlow production。
- 部署：draft 驗收 `netlify deploy --dir dist --no-build --site fps-lin`；`--prod` 對應 main。
- debug hooks：`window.__p96`：levelHash、frames、gameState、ammo()、enemiesAlive()、playerHp()、fire()、aimAt(i，索引存活清單)、damagePlayer(n)；debug.*：setState、grantWeapon、clearArea('B'|'C')、doorState('door-a'|'door-b'|'door-end')、teleportPlayer({x,y,z})、lookAt({x,y,z})（**皆吃物件不吃散裝數字**）、enemyTransforms()、pickupsRemaining()（回陣列）、musicState()、maxFrameMs()、forceComplete、setFreezeFx。
- 鐵則：repo 零素材檔、dependencies 永遠為空、玩法生成純 CPU 決定性（PLAN §6.4、§7.5）。門要「條件達成且玩家走近」才開。

## 待辦與已知事項

1. **M3 範圍（PLAN §9）**：區域 D 至 F、電漿步槍（投射物）、能量砲、射擊體、守衛體、首領戰、結束畫面、無障礙選項、傳輸容量 ≤2MB。
2. 敵人警示橘僅正面（背對融入黑暗），屬刻意恐懼取捨；Lin 未再反映挫折，維持現狀，M3 有回饋再調。
3. 跨機 levelHash 一致性未實測（在 MBP 開專案時對 golden `31f07cb9` 驗一次）。
4. 材質生成同步阻塞約 89ms（M1 審查量測），未分幀；M3 材質變多時再排 PLAN §6.4 的分幀化。
5. M2 AC「外部測試者無解說通關」尚未執行（Lin 本人驗收通過）；M3 起 3 至 5 名外部測試是 AC 硬項。
6. AC_m2-phase3-audio-crossbrowser.md 為第三階段派工的 AC 落檔（含幀量測斷言放寬至 1000ms 的理由），保留作紀錄。

## 換機器怎麼接

```
cd ~/Projects && gh repo clone Healon/fps-lin && cd fps-lin
npm install
npm run gate
```

全綠即就緒（三引擎 smoke 首次需 `npx playwright install webkit firefox`）。dev：`npm run dev`（埠 8330）。決策脈絡：PLAN §2（D-001 至 D-005）與各節版本註記。
