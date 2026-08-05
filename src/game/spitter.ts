// 射擊體（Spitter）FSM 與移動：Idle → Detect（距離加視線）→ Reposition（與玩家保持中距，
// 橫向漂移找 LOS，近身時後退拉開距離）→ Windup（0.4 秒蓄力，橘光增強當 telegraph）→ Shoot
// （發射投射物，單幀狀態立即回到 Reposition）；或 Hurt（短暫硬直）→ Reposition；或 Dead
// （溶解淡出後移除）。數值取自 PLAN §3.4：HP 45、速度 3.0 m/s、投射傷害 8 每 1.5 秒、
// 投射速度約 12 m/s（PLAN §3.4：「尋找射擊位置保持中距，迫使玩家移動」）。
//
// 決定性鐵則：本檔全程禁止 Math.random／Date，橫向漂移只用敵人 id（相位）與模擬累計時間
// （同 game/enemy.ts Crawler 的 chase 漂移慣例）。本檔刻意不 import procgen/mesh（邏輯層與
// 外觀層解耦，同 Crawler 慣例），發射事件（SpitterShootEvent）只回報世界座標與方向，
// 由 main.ts 呼叫 game/projectiles.ts 的 ProjectileSystem 實際產生投射物。

import type { Vec3 } from "../core/math.ts";
import { subVec3, lengthVec3, normalizeVec3 } from "../core/math.ts";
import type { Aabb } from "../procgen/level/level.ts";
import { resolveAxisMove, hasClearLineOfSight } from "./collision.ts";

export type SpitterState = "idle" | "detect" | "reposition" | "windup" | "shoot" | "hurt" | "dead";

export const SPITTER_MAX_HP = 45;
export const SPITTER_SPEED = 3.0; // m/s（PLAN §3.4）
export const SPITTER_PROJECTILE_DAMAGE = 8;
export const SPITTER_ATTACK_INTERVAL = 1.5; // 秒，投射攻擊間隔（PLAN §3.4：投射 8 傷每 1.5 秒）
export const SPITTER_PROJECTILE_SPEED = 12; // m/s（PLAN §3.4：約 12 m/s）
export const SPITTER_WINDUP_DURATION = 0.4; // 秒，蓄力時長（本次派工規格）
export const SPITTER_MIN_KEEP_DISTANCE = 6; // m，PLAN §3.4：與玩家保持中距 6～10m
export const SPITTER_MAX_KEEP_DISTANCE = 10;

const DETECT_RANGE = 16; // m，射擊體為遠程單位，偵測距離大於巡行體
const GIVE_UP_RANGE = 20; // m，追丟（或蓄力中失去視線）後放棄的距離
const DETECT_REACTION_TIME = 0.3; // 秒，同 Crawler 慣例：給玩家反應空檔
const HURT_STAGGER_DURATION = 0.25; // 秒
const DEATH_DISSOLVE_DURATION = 1.2; // 秒
const HIT_FLASH_DURATION = 0.1; // 秒
const SPITTER_MUZZLE_HEIGHT = 1.75; // m，近似頭部發光砲口高度（供投射物視覺起點，見 getMuzzleWorldPosition）

// 橫向漂移相位縮放（同 Crawler CHASE_DRIFT_ID_PHASE_SCALE 慣例，純技術細節非難度旋鈕）。
const STRAFE_PERIOD_SECONDS = 3.5;
const STRAFE_ID_PHASE_SCALE = 1.9;
const STRAFE_ANGULAR_FREQUENCY = (2 * Math.PI) / STRAFE_PERIOD_SECONDS;

/** 命中判定尺寸（本次派工規格）：與視覺模型尺寸解耦，同 Crawler CRAWLER_HALF 慣例。
 *  水平尺寸須涵蓋視覺輪廓（含腿部外張）的旋轉包絡，見 procgen/mesh/spitter.ts 不變量測試。 */
export const SPITTER_HALF: Vec3 = { x: 0.32, y: 0.95, z: 0.38 };

/** 由移動方向反推面向 yaw（同 game/enemy.ts 慣例：yaw 0 朝 -Z）。 */
function yawFromDirectionXZ(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, -dirZ);
}

export interface SpitterFsmContext {
  distanceToPlayer: number;
  hasLineOfSight: boolean;
  /** 已在目前狀態停留的秒數。 */
  stateTimer: number;
  /** 投射攻擊冷卻是否已完成（reposition 進入 windup 的必要條件之一）。 */
  attackReady: boolean;
}

/**
 * 純函式 FSM 轉移表（同 game/enemy.ts transition() 慣例：不含副作用，供單元測試逐條驗證
 * 決定性）。hurt／dead 的「進入」由 Spitter.applyDamage() 直接指定，本函式只負責之後的
 * 離開判斷，以及 idle/detect/reposition/windup/shoot 之間的巡邏轉移。
 */
export function transition(current: SpitterState, ctx: SpitterFsmContext): SpitterState {
  switch (current) {
    case "dead":
      return "dead";
    case "hurt":
      return ctx.stateTimer >= HURT_STAGGER_DURATION ? "reposition" : "hurt";
    case "idle":
      return ctx.hasLineOfSight && ctx.distanceToPlayer <= DETECT_RANGE ? "detect" : "idle";
    case "detect":
      if (!ctx.hasLineOfSight || ctx.distanceToPlayer > DETECT_RANGE) return "idle";
      return ctx.stateTimer >= DETECT_REACTION_TIME ? "reposition" : "detect";
    case "reposition":
      if (ctx.distanceToPlayer > GIVE_UP_RANGE) return "idle";
      if (
        ctx.hasLineOfSight &&
        ctx.attackReady &&
        ctx.distanceToPlayer >= SPITTER_MIN_KEEP_DISTANCE &&
        ctx.distanceToPlayer <= SPITTER_MAX_KEEP_DISTANCE
      ) {
        return "windup";
      }
      return "reposition";
    case "windup":
      // 蓄力中止：目標消失於視線或跑到放棄距離外，回 reposition 不發射（避免對空/穿牆蓄力後
      // 打出無意義的一發）。
      if (!ctx.hasLineOfSight || ctx.distanceToPlayer > GIVE_UP_RANGE) return "reposition";
      return ctx.stateTimer >= SPITTER_WINDUP_DURATION ? "shoot" : "windup";
    case "shoot":
      // 單幀狀態：發射後立即回到 reposition，冷卻由 attackCooldown 另計。
      return "reposition";
    default:
      return current;
  }
}

export interface SpitterShootEvent {
  origin: Vec3;
  /** 已正規化，朝向玩家（眼睛高度）方向。 */
  dir: Vec3;
  damage: number;
}

export class Spitter {
  readonly id: number;
  /** 所屬區域標記（同 Crawler 慣例，供 debug／測試分組）。 */
  readonly area?: string;
  /** 腳底位置。 */
  position: Vec3;
  hp = SPITTER_MAX_HP;
  state: SpitterState;
  private stateTimer = 0;
  private attackCooldown = 0;
  private hitFlashTimer = 0;
  private elapsedTime = 0;
  private facingYaw = 0;

  constructor(id: number, spawnPosition: Vec3, initialState: SpitterState = "idle", area?: string) {
    this.id = id;
    this.position = { ...spawnPosition };
    this.state = initialState;
    this.area = area;
  }

  getCenter(): Vec3 {
    return { x: this.position.x, y: this.position.y + SPITTER_HALF.y, z: this.position.z };
  }

  getAabb(): Aabb {
    const c = this.getCenter();
    return {
      min: { x: c.x - SPITTER_HALF.x, y: c.y - SPITTER_HALF.y, z: c.z - SPITTER_HALF.z },
      max: { x: c.x + SPITTER_HALF.x, y: c.y + SPITTER_HALF.y, z: c.z + SPITTER_HALF.z },
    };
  }

  /** 目前面向 yaw（弧度），供 renderer 建立含旋轉的 model matrix（全程面向玩家，砲塔式）。 */
  get yaw(): number {
    return this.facingYaw;
  }

  get removable(): boolean {
    return this.state === "dead" && this.stateTimer >= DEATH_DISSOLVE_DURATION;
  }

  get dissolveProgress(): number {
    if (this.state !== "dead") return 0;
    return Math.min(1, this.stateTimer / DEATH_DISSOLVE_DURATION);
  }

  get hitFlashIntensity(): number {
    return this.hitFlashTimer / HIT_FLASH_DURATION;
  }

  /** 蓄力進度 0（未蓄力）至 1（即將發射），供 renderer 端增強橘光 telegraph；非 windup 時回 0。 */
  get telegraphIntensity(): number {
    if (this.state !== "windup") return 0;
    return Math.min(1, this.stateTimer / SPITTER_WINDUP_DURATION);
  }

  /** 套用傷害；回傳是否為致命一擊（觸發 Dead 狀態）。已死亡則忽略並回傳 false。 */
  applyDamage(amount: number): boolean {
    if (this.state === "dead") return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.state = "dead";
      this.stateTimer = 0;
      return true;
    }
    this.state = "hurt";
    this.stateTimer = 0;
    this.hitFlashTimer = HIT_FLASH_DURATION;
    return false;
  }

  private moveOnly(dirX: number, dirZ: number, speed: number, dt: number, colliders: Aabb[], center: Vec3): void {
    const moveX = dirX * speed * dt;
    const moveZ = dirZ * speed * dt;

    let c = center;
    const rx = resolveAxisMove(c, SPITTER_HALF, "x", moveX, colliders);
    c = { ...c, x: c.x + rx.delta };
    const rz = resolveAxisMove(c, SPITTER_HALF, "z", moveZ, colliders);
    c = { ...c, z: c.z + rz.delta };

    this.position = { x: c.x, y: this.position.y, z: c.z };
  }

  /** 近似頭部發光砲口的世界座標（供投射物視覺起點；不需精確至頂點層級，見常數註解）。 */
  private getMuzzleWorldPosition(): Vec3 {
    return { x: this.position.x, y: this.position.y + SPITTER_MUZZLE_HEIGHT, z: this.position.z };
  }

  /**
   * 每幀更新：FSM 轉移、reposition 移動（維持中距／近身後退／橫向漂移找 LOS）、windup／shoot
   * 觸發投射攻擊事件。回傳本幀是否觸發發射（供呼叫端把事件交給 game/projectiles.ts），
   * 無發射則回傳 null。
   */
  update(dt: number, playerFeet: Vec3, playerEye: Vec3, colliders: Aabb[]): SpitterShootEvent | null {
    this.stateTimer += dt;
    this.elapsedTime += dt;
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    if (this.state === "dead") return null;

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const center = this.getCenter();
    const toPlayer = subVec3(playerFeet, this.position);
    const distance = lengthVec3(toPlayer);
    const withinDetectRange = distance <= DETECT_RANGE;
    const hasLos = withinDetectRange && hasClearLineOfSight(center, playerEye, colliders);

    const ctx: SpitterFsmContext = {
      distanceToPlayer: distance,
      hasLineOfSight: hasLos,
      stateTimer: this.stateTimer,
      attackReady: this.attackCooldown <= 0,
    };

    const next = transition(this.state, ctx);
    if (next !== this.state) {
      this.state = next;
      this.stateTimer = 0;
    }

    let shootEvent: SpitterShootEvent | null = null;
    if (this.state === "shoot") {
      this.attackCooldown = SPITTER_ATTACK_INTERVAL;
      const origin = this.getMuzzleWorldPosition();
      const aimVector = subVec3(playerEye, origin);
      if (lengthVec3(aimVector) > 1e-4) {
        shootEvent = { origin, dir: normalizeVec3(aimVector), damage: SPITTER_PROJECTILE_DAMAGE };
      }
    }

    // 移動與朝向：全程面向玩家（砲塔式，dt<=0 時完全略過，同 Crawler 的 debug.setFreezeFx 慣例）。
    if (dt > 0 && distance > 1e-4) {
      const towardX = toPlayer.x / distance;
      const towardZ = toPlayer.z / distance;
      this.facingYaw = yawFromDirectionXZ(towardX, towardZ);

      if (this.state === "reposition") {
        if (distance < SPITTER_MIN_KEEP_DISTANCE) {
          this.moveOnly(-towardX, -towardZ, SPITTER_SPEED, dt, colliders, center); // 近身後退拉開距離
        } else if (distance > SPITTER_MAX_KEEP_DISTANCE) {
          this.moveOnly(towardX, towardZ, SPITTER_SPEED, dt, colliders, center); // 追近至射程內
        } else {
          // 橫向漂移找 LOS（決定性：只用 id 相位與模擬累計時間，同 Crawler chase 漂移慣例）。
          const phase = this.id * STRAFE_ID_PHASE_SCALE;
          const strafeSign = Math.sin(this.elapsedTime * STRAFE_ANGULAR_FREQUENCY + phase) >= 0 ? 1 : -1;
          const perpX = -towardZ * strafeSign;
          const perpZ = towardX * strafeSign;
          this.moveOnly(perpX, perpZ, SPITTER_SPEED, dt, colliders, center);
        }
      }
    }

    return shootEvent;
  }
}
