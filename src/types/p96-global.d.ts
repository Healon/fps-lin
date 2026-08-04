// 共用的 window.__p96 debug hook 型別宣告（主程式與 Playwright 測試共用，避免兩處宣告衝突）。
export {};

declare global {
  interface Window {
    __p96?: {
      ready: boolean;
      frames: number;
      levelHash: string;
      /** 存活敵人數（state !== "dead"，不等待死亡溶解動畫播完）。 */
      enemiesAlive: () => number;
      playerHp: () => number;
      /** 程式觸發一次開火，用當前視角；回傳是否真的開火（冷卻中或無彈藥則 false）。 */
      fire: () => boolean;
      /** 直接對玩家造成傷害（略過敵人近戰路徑），回傳是否生效（無敵中或已死亡則 false）。 */
      damagePlayer: (amount: number) => boolean;
      /** 把視角對準第 enemyIndex 個「存活」敵人（依 enemiesAlive 的同一順序索引）。 */
      aimAt: (enemyIndex: number) => boolean;
      /** 驗收／截圖用 debug 手段，預設不影響正常遊玩。 */
      debug: {
        /** true 時凍結射擊特效計時器（後座／槍口閃光／tracer／火花不再衰減），方便截圖。 */
        setFreezeFx: (enabled: boolean) => void;
        /** 直接傳送玩家腳底位置（略過移動與碰撞），供驗收截圖取景使用。 */
        teleportPlayer: (pos: { x: number; y: number; z: number }) => void;
        /** 把視角對準任意世界座標點（不限敵人），供驗收截圖取景使用。 */
        lookAt: (target: { x: number; y: number; z: number }) => void;
        /** 回傳目前存活（含 hurt／retreat／chase 等，排除 dead）敵人的位置與朝向，供驗收截圖取景使用。 */
        enemyTransforms: () => { x: number; y: number; z: number; yaw: number; state: string }[];
      };
    };
  }
}
