// 控制台互動系統（M3 新增）：玩家走近區域 D 控制台觸發 HUD 提示，按 E 啟動；啟動為一次性、
// 不可逆（同輪遊玩內），door-d 的 'console-activated' 條件即讀 isActivated。純邏輯，無 DOM／GL
// 依賴，可獨立單元測試；main.ts 負責在 E 鍵邊緣觸發時呼叫 tryActivate() 並播放確認音效、
// 依 isActivated 切換 console-idle／console-active 兩份 prop 網格（見 procgen/mesh/console.ts）。

import type { Vec3 } from "../core/math.ts";
import type { ConsoleDef } from "../procgen/level/level.ts";

/** 走近觸發 HUD 提示與可啟動範圍的距離（公尺），PLAN 本次派工規格：1.5m 內。 */
const PROMPT_RADIUS = 1.5;

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export class ConsoleSystem {
  private activated = false;
  private readonly def: ConsoleDef;

  constructor(def: ConsoleDef) {
    this.def = def;
  }

  get isActivated(): boolean {
    return this.activated;
  }

  /** 已啟動則恆為 false（提示只在「尚未啟動且在範圍內」時顯示）。 */
  isPromptVisible(playerPos: Vec3): boolean {
    if (this.activated) return false;
    return distanceXZ(playerPos, this.def.pos) <= PROMPT_RADIUS;
  }

  /**
   * 嘗試啟動（真實輸入路徑：E 鍵邊緣觸發時呼叫）：需在提示半徑內且尚未啟動，
   * 回傳是否真的啟動（供呼叫端判斷要不要播放確認音效與觸發面板變色）。
   */
  tryActivate(playerPos: Vec3): boolean {
    if (this.activated) return false;
    if (distanceXZ(playerPos, this.def.pos) > PROMPT_RADIUS) return false;
    this.activated = true;
    return true;
  }

  /** 強制啟動，略過距離檢查（debug 手段，同 grantWeapon／clearArea 慣例，供測試跳過走位）。 */
  forceActivate(): boolean {
    if (this.activated) return false;
    this.activated = true;
    return true;
  }

  /** 重置為未啟動（供死亡重生／重新開始使用，關卡從頭來過）。 */
  reset(): void {
    this.activated = false;
  }
}
