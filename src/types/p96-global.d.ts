// 共用的 window.__p96 debug hook 型別宣告（主程式與 Playwright 測試共用，避免兩處宣告衝突）。
import type { GameState } from "../game/state.ts";
import type { Settings } from "../core/settings.ts";

export {};

declare global {
  interface Window {
    __p96?: {
      ready: boolean;
      frames: number;
      levelHash: string;
      /** 目前遊戲狀態（menu／playing／paused，見 game/state.ts）。M2 新增。 */
      readonly gameState: GameState;
      /** 存活敵人數（state !== "dead"，不等待死亡溶解動畫播完）。 */
      enemiesAlive: () => number;
      /** 存活射擊體數（M3 新增，同 enemiesAlive 慣例）。 */
      spittersAlive: () => number;
      /** 存活守衛體數（M3 第二階段新增，同 enemiesAlive 慣例）。 */
      wardensAlive: () => number;
      playerHp: () => number;
      /** 目前武器彈藥數（M2 新增，供 menu 狀態射擊閘門測試驗證彈藥未變化）；未裝備武器時為 0。 */
      ammo: () => number;
      /** 目前裝備中的武器 id（M2 新增，M3 第二階段擴充 "plasma"），未持有任何武器時為 null。 */
      currentWeapon: () => "pistol" | "shotgun" | "plasma" | null;
      /** 全程累計擊殺數（M2 新增，供通關畫面與驗收讀取）。 */
      kills: () => number;
      /** 程式觸發一次開火，用當前視角；回傳是否真的開火（冷卻中或無彈藥則 false）。
       *  debug 手段，任何遊戲狀態下都直接生效，繞過真實輸入路徑的狀態閘（M2 規格）。 */
      fire: () => boolean;
      /** 直接對玩家造成傷害（略過敵人近戰路徑），回傳是否生效（無敵中或已死亡則 false）。
       *  debug 手段，任何遊戲狀態下都直接生效。 */
      damagePlayer: (amount: number) => boolean;
      /** 把視角對準第 enemyIndex 個「存活」敵人（依 enemiesAlive 的同一順序索引）。 */
      aimAt: (enemyIndex: number) => boolean;
      /** 驗收／截圖用 debug 手段，預設不影響正常遊玩。 */
      debug: {
        /** true 時凍結射擊特效計時器（後座／槍口閃光／tracer／火花不再衰減），方便截圖。 */
        setFreezeFx: (enabled: boolean) => void;
        /** 直接傳送玩家腳底位置（略過移動與碰撞），供驗收截圖取景使用。 */
        teleportPlayer: (pos: { x: number; y: number; z: number }) => void;
        /** 目前玩家腳底世界座標（M2 新增，供驗收讀取移動是否被門／牆碰撞擋住）。 */
        getPlayerPosition: () => { x: number; y: number; z: number };
        /** 尚未撿取的撿取物清單（M2 新增，除錯與驗收用，確認撿取／渲染狀態是否一致）。 */
        pickupsRemaining: () => { kind: string; pos: { x: number; y: number; z: number } }[];
        /** 把視角對準任意世界座標點（不限敵人），供驗收截圖取景使用。 */
        lookAt: (target: { x: number; y: number; z: number }) => void;
        /** 回傳目前存活（含 hurt／retreat／chase 等，排除 dead）敵人的位置與朝向，供驗收截圖取景使用。
         *  area（M3 第二階段新增）供測試依區域篩選（可能為 undefined，見 EnemySpawnDef.area）。 */
        enemyTransforms: () => { x: number; y: number; z: number; yaw: number; state: string; area?: string }[];
        /** 存活守衛體的位置／面向／狀態／HP（M3 第二階段新增，供驗收截圖取景，並供「正面打
         *  守衛體傷害減半」的測試以 damage 前後 HP 差比較驗證方向性減傷）。 */
        wardenTransforms: () => { x: number; y: number; z: number; yaw: number; state: string; hp: number }[];
        /** 直接切換遊戲狀態，測試用，繞過正常轉移路徑（M2 新增，見 game/state.ts）。 */
        setState: (state: GameState) => void;
        /** 目前套用中的設定（M2 新增，供 reload 後驗收設定是否讀回一致）。 */
        getSettings: () => Readonly<Settings>;
        /** renderer 目前實際套用的 FOV（度），與 getSettings().fov 分開驗證「真的套用到渲染」。 */
        getFov: () => number;
        /** 直接給予武器（跳過走到台座撿取），等效於實際撿取（含自動裝備／觸發區域 C 伏擊），
         *  供 Playwright 劇本跳過長距離走位（M2 新增，M3 第二階段擴充 "plasma"）。 */
        grantWeapon: (id: "pistol" | "shotgun" | "plasma") => void;
        /** 直接清空指定區域全部存活敵人（等效瞬間擊殺，供測試跳過戰鬥磨耗，M2 新增；
         *  M3 擴充涵蓋區域 D 的射擊體；M3 第二階段擴充涵蓋區域 E 的巡行體加射擊體加守衛體）。 */
        clearArea: (area: "B" | "C" | "D" | "E") => void;
        /** 查詢指定門目前狀態（M2 新增），查無此門則回傳 undefined。 */
        doorState: (doorId: string) => "closed" | "opening" | "open" | undefined;
        /** 強制啟動區域 D 控制台，略過走近距離（M3 新增，同 grantWeapon／clearArea 慣例）。 */
        activateConsole: () => void;
        /** 直接傳送玩家並瞬間觸發通關（等效走進終點觸發區，供測試跳過完整戰鬥流程，M2 新增）。 */
        forceComplete: () => void;
        /** 目前音樂邏輯狀態（M2 第三階段新增，見 audio/music.ts）：'off' 為尚未啟動或已停止，
         *  'explore'／'combat' 為雙態音樂系統目前所在的附加層（3 秒滯後才回 explore）。 */
        musicState: () => "off" | "explore" | "combat";
        /** 自 ready 起算的單幀最大耗時（毫秒，M2 第三階段新增，見 core/loop.ts）；取夾限前的
         *  原始幀間時間差，反映真實卡頓而非模擬用的已夾限 dt。 */
        maxFrameMs: () => number;
        /** 歸零 maxFrameMs 的量測基準（M2 第三階段新增），供測試在特定劇本段落前重置。 */
        resetMaxFrameMs: () => void;
      };
    };
  }
}
