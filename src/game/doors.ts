// 門系統：追蹤每扇門的開關狀態（closed／opening／open）與滑動進度，依條件（持有武器／
// 區域敵人全滅）加玩家靠近距離自動觸發開啟。純邏輯，無 DOM／GL 依賴，可獨立單元測試；
// main.ts 依 activeColliders() 併入每幀的碰撞清單，依 list() 的 progress 建立渲染用的滑動
// model matrix，依 nearestLockedHint() 驅動 HUD 鎖定提示。
//
// 決定性備註：門的觸發條件（是否持有武器、區域是否清空）與位置皆為執行期的遊戲狀態（非
// PLAN §6.4 的「生成」範疇），本模組的計時（滑動進度）與其餘遊戲邏輯模組（combat.ts／
// enemy.ts／effects.ts）同慣例，以 dt 累加，不使用 Math.random／Date。

import type { Vec3 } from "../core/math.ts";
import type { Aabb, DoorDef, DoorOpenCondition } from "../procgen/level/level.ts";

export type DoorStatus = "closed" | "opening" | "open";

export interface DoorRuntimeContext {
  hasWeapon: boolean;
  areaClearB: boolean;
  areaClearC: boolean;
  /** M3 新增：區域 D 控制台是否已啟動（見 game/console.ts）。 */
  consoleActivated: boolean;
  /** M3 第二階段新增：區域 E（巡行體加射擊體加守衛體）是否全滅。 */
  areaClearE: boolean;
}

export interface DoorRuntimeState {
  readonly def: DoorDef;
  status: DoorStatus;
  /** 0（緊閉）至 1（全開）滑動進度。 */
  progress: number;
  /** M3 第三階段新增（首領戰大門）：一旦為 true，update() 完全略過此門（不再評估條件、
   *  不再滑動），碰撞體維持 lock() 呼叫當下設定的狀態（見 lock()）。一般門永不設定此欄位。 */
  locked: boolean;
}

/** 觸發自動開啟所需的玩家靠近距離（公尺），沿用門 A 規格「2m 內自動滑開」套用至三扇門。 */
const TRIGGER_RADIUS = 2.0;
/** HUD 鎖定提示顯示半徑（略大於觸發距離，讓玩家提早看到「為什麼還沒開」）。 */
const HINT_RADIUS = 4.5;
/** 滑動開啟總時長（秒），PLAN 本次派工規格：約 0.8 秒。 */
export const DOOR_SLIDE_DURATION = 0.8;

export const DOOR_HINT_TEXT: Readonly<Record<DoorOpenCondition, string>> = {
  "has-weapon": "需要武器",
  "area-clear:B": "偵測到生命跡象，門鎖定中",
  "area-clear:C": "偵測到生命跡象，門鎖定中",
  "console-activated": "控制台尚未啟動，門鎖定中",
  "area-clear:E": "偵測到生命跡象，門鎖定中",
  /** 恆真條件（M3 第三階段：首領戰大門），走近即開，永不顯示鎖定提示（見 nearestLockedHint
   *  只在 !conditionMet 時才回傳提示文字，本條件恆為 true 故此字串實務上不會被讀取）。 */
  none: "",
};

function conditionMet(condition: DoorOpenCondition, ctx: DoorRuntimeContext): boolean {
  switch (condition) {
    case "has-weapon":
      return ctx.hasWeapon;
    case "area-clear:B":
      return ctx.areaClearB;
    case "area-clear:C":
      return ctx.areaClearC;
    case "console-activated":
      return ctx.consoleActivated;
    case "area-clear:E":
      return ctx.areaClearE;
    case "none":
      return true;
    default:
      return false;
  }
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export class DoorSystem {
  private readonly states: DoorRuntimeState[];
  private onOpenStartCb: ((id: string) => void) | null = null;

  constructor(doors: readonly DoorDef[]) {
    this.states = doors.map((def) => ({ def, status: "closed" as DoorStatus, progress: 0, locked: false }));
  }

  /** 門開始滑動當幀觸發一次（供 main.ts 播放門機械聲，避免每幀重複播放）。 */
  onOpenStart(cb: (id: string) => void): void {
    this.onOpenStartCb = cb;
  }

  list(): readonly DoorRuntimeState[] {
    return this.states;
  }

  get(id: string): DoorRuntimeState | undefined {
    return this.states.find((s) => s.def.id === id);
  }

  /** 尚未完全開啟（closed 或 opening 中）的門，其關閉時碰撞體仍計入 active colliders。 */
  activeColliders(): Aabb[] {
    return this.states.filter((s) => s.status !== "open").map((s) => s.def.collider);
  }

  /** 重置所有門回到緊閉狀態（供死亡重生／重新開始使用，關卡從頭來過）。 */
  reset(): void {
    for (const s of this.states) {
      s.status = "closed";
      s.progress = 0;
      s.locked = false;
    }
  }

  /**
   * 永久鎖定一扇門（M3 第三階段新增，首領戰大門）：立即強制設為緊閉（碰撞體生效）並標記
   * locked=true，此後 update() 完全略過此門，不論條件是否達成、玩家是否靠近皆不再滑開
   * （見類別頭註解）。查無此門 id 則無動作。main.ts 於偵測玩家跨入首領大廳時呼叫。
   */
  lock(id: string): void {
    const s = this.states.find((s) => s.def.id === id);
    if (!s) return;
    s.status = "closed";
    s.progress = 0;
    s.locked = true;
  }

  update(dt: number, ctx: DoorRuntimeContext, playerPos: Vec3): void {
    for (const s of this.states) {
      if (s.locked) continue;
      if (s.status === "closed") {
        if (conditionMet(s.def.condition, ctx) && distanceXZ(playerPos, s.def.pos) <= TRIGGER_RADIUS) {
          s.status = "opening";
          this.onOpenStartCb?.(s.def.id);
        }
      } else if (s.status === "opening") {
        s.progress = Math.min(1, s.progress + dt / DOOR_SLIDE_DURATION);
        if (s.progress >= 1) s.status = "open";
      }
    }
  }

  /** 距離最近、條件尚未達成的鎖定門若在提示半徑內，回傳其提示文字；否則 null。
   *  條件已達成但尚未觸發開啟（例如稍遠處剛清完敵人，走近途中）不算「鎖定」，不顯示提示。 */
  nearestLockedHint(ctx: DoorRuntimeContext, playerPos: Vec3): string | null {
    let best: { dist: number; text: string } | null = null;
    for (const s of this.states) {
      if (s.status !== "closed") continue;
      if (conditionMet(s.def.condition, ctx)) continue;
      const dist = distanceXZ(playerPos, s.def.pos);
      if (dist <= HINT_RADIUS && (!best || dist < best.dist)) {
        best = { dist, text: DOOR_HINT_TEXT[s.def.condition] };
      }
    }
    return best?.text ?? null;
  }
}
