// 守衛體（Warden）FSM 與移動：Idle → Detect（距離加視線）→ Advance（緩慢逼近，決定性漂移
// 幅度小）→ Windup（0.5 秒蓄力 telegraph，與玩家距離 4～7m 且有 LOS 時觸發，原地不動）→
// Charge（以 6 m/s 直線衝撞 1 秒，命中玩家造成傷害加短暫擊退，命中後提前結束回 Advance）→
// Attack（近戰，命中即回 Advance 的節奏交由 attackCooldown 控制，同 Crawler 慣例持續在
// attack 狀態內反覆觸發）；或 Hurt（短暫硬直，較 Crawler／Spitter 更短，重甲感）→ Advance；
// 或 Dead（溶解淡出後移除）。數值取自 PLAN §3.4：HP 160、速度 1.8 m/s、近戰 25 加衝撞，
// 正面減傷 50%（本次派工規格細節：衝撞 6 m/s／1 秒／25 傷加短暫擊退、蓄力 0.5 秒、
// 衝撞冷卻約 4 秒、近戰間隔 1.2 秒、硬直 0.15 秒）。
//
// 決定性鐵則：本檔全程禁止 Math.random／Date，advance 的橫向漂移只用敵人 id（相位）與模擬
// 累計時間（同 game/enemy.ts Crawler、game/spitter.ts Spitter 的漂移慣例），漂移幅度明顯小於
// Crawler（「緩慢逼近，決定性漂移幅度小」，本次派工規格）。本檔刻意不 import procgen/mesh
// （邏輯層與外觀層解耦，同 Crawler／Spitter 慣例）。
//
// 方向性減傷：applyDamage(amount, hitDirection) 比較「命中方向（攻擊者→守衛體的行進方向）」
// 與「守衛體面向」，若守衛體正朝向攻擊者來源方向（即 hitDirection 大致與面向相反，夾角
// < 60 度視為命中正面裝甲板）則傷害減半，否則（含未提供 hitDirection 的情境，如 debug 一擊必殺）
// 全額傷害。純函式 isFrontHit() 對外匯出，供單元測試逐條鎖定角度邊界。

import type { Vec3 } from "../core/math.ts";
import { subVec3, lengthVec3 } from "../core/math.ts";
import type { Aabb } from "../procgen/level/level.ts";
import { resolveAxisMove, hasClearLineOfSight } from "./collision.ts";

export type WardenState = "idle" | "detect" | "advance" | "windup" | "charge" | "attack" | "hurt" | "dead";

export const WARDEN_MAX_HP = 160;
export const WARDEN_SPEED = 1.8; // m/s（PLAN §3.4）
export const WARDEN_MELEE_DAMAGE = 25;
export const WARDEN_MELEE_INTERVAL = 1.2; // 秒
export const WARDEN_CHARGE_SPEED = 6; // m/s（本次派工規格）
export const WARDEN_CHARGE_DURATION = 1; // 秒
export const WARDEN_CHARGE_WINDUP_DURATION = 0.5; // 秒
export const WARDEN_CHARGE_DAMAGE = 25;
export const WARDEN_CHARGE_COOLDOWN = 4; // 秒
export const WARDEN_CHARGE_MIN_RANGE = 4; // m
export const WARDEN_CHARGE_MAX_RANGE = 7; // m
export const WARDEN_FRONT_DAMAGE_MULTIPLIER = 0.5;
export const WARDEN_FRONT_ARC_DEGREES = 60;
/** 擊退距離（公尺，M3 第二階段規格：衝撞命中造成「短暫擊退」）。 */
export const WARDEN_KNOCKBACK_DISTANCE = 1.2;

const DETECT_RANGE = 14; // m
const GIVE_UP_RANGE = 20; // m
const ATTACK_RANGE = 1.8; // m，體型較大，觸及距離略大於 Crawler（1.5m）
/** 衝撞命中判定距離（公尺）：守衛體與玩家中心距離小於此值視為衝撞命中，近似兩者水平半寬
 *  相加加安全餘量，刻意不 import PLAYER_HALF（邏輯層解耦，同檔頭註解慣例，自成獨立常數）。 */
const CHARGE_HIT_RANGE = 1.3;
const DETECT_REACTION_TIME = 0.3; // 秒
const HURT_STAGGER_DURATION = 0.15; // 秒（本次派工規格：較 Crawler/Spitter 短，重甲感）
const DEATH_DISSOLVE_DURATION = 1.4; // 秒，較 Crawler／Spitter 略長（厚重機體）
const HIT_FLASH_DURATION = 0.1; // 秒

// advance 橫向漂移（決定性，「幅度小」：明顯小於 Crawler 的 ±35 度）。
const ADVANCE_DRIFT_MAX_RADIANS = (12 * Math.PI) / 180; // 約 ±12 度
const ADVANCE_DRIFT_PERIOD_SECONDS = 4.0;
const ADVANCE_DRIFT_ID_PHASE_SCALE = 2.3;
const ADVANCE_DRIFT_ANGULAR_FREQUENCY = (2 * Math.PI) / ADVANCE_DRIFT_PERIOD_SECONDS;

/** 命中判定尺寸（本次派工規格：「厚重寬體約 2.0m 高」）。水平尺寸須涵蓋視覺輪廓（含正面
 *  裝甲板）的旋轉包絡，見 procgen/mesh/warden.ts 不變量測試。刻意比 Crawler／Spitter 更寬
 *  （x 軸），呼應「寬 vs 高瘦 vs 矮壯」的剪影差異（本次派工規格）。 */
export const WARDEN_HALF: Vec3 = { x: 0.6, y: 1.0, z: 0.55 };

/** 由移動方向反推面向 yaw（同 game/enemy.ts／game/spitter.ts 慣例：yaw 0 朝 -Z）。 */
function yawFromDirectionXZ(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, -dirZ);
}

/** 由 yaw 反推水平面向向量（forwardFromYawPitch 的水平簡化版，本檔刻意不 import
 *  core/math.ts 的完整版本，維持與 yawFromDirectionXZ 同檔案內自洽，同 Crawler／Spitter 慣例）。 */
function forwardFromYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

const FRONT_ARC_COS_THRESHOLD = -Math.cos((WARDEN_FRONT_ARC_DEGREES * Math.PI) / 180);

/**
 * 純函式：命中方向（攻擊者→守衛體的行進方向，需為單位向量，只看水平分量）是否落在守衛體
 * 正面弧（面向 facingYaw，夾角 < WARDEN_FRONT_ARC_DEGREES 度）。守衛體面向攻擊者來源方向時
 * （即攻擊行進方向與面向大致相反），代表命中其正面裝甲板。供單元測試逐條鎖定角度邊界。
 */
export function isFrontHit(hitDirection: Vec3, facingYaw: number): boolean {
  const forward = forwardFromYaw(facingYaw);
  const dot = hitDirection.x * forward.x + hitDirection.z * forward.z;
  return dot < FRONT_ARC_COS_THRESHOLD;
}

export interface WardenFsmContext {
  distanceToPlayer: number;
  hasLineOfSight: boolean;
  inAttackRange: boolean;
  stateTimer: number;
  /** 衝撞冷卻是否已完成（advance 進入 windup 的必要條件之一）。 */
  chargeReady: boolean;
  /** 距離是否落在衝撞觸發帶（WARDEN_CHARGE_MIN_RANGE 至 WARDEN_CHARGE_MAX_RANGE）。 */
  inChargeBand: boolean;
}

/**
 * 純函式 FSM 轉移表（同 game/enemy.ts／game/spitter.ts 慣例：不含副作用，供單元測試逐條驗證
 * 決定性）。hurt／dead 的「進入」由 Warden.applyDamage() 直接指定；charge 命中提前結束
 * （轉 advance）由 Warden.update() 的衝撞命中判定直接指定，略過本函式（與 Crawler
 * 「攻擊命中即後撤」直接指定 retreat 同慣例，見下方 update() 內註解）。
 */
export function transition(current: WardenState, ctx: WardenFsmContext): WardenState {
  switch (current) {
    case "dead":
      return "dead";
    case "hurt":
      return ctx.stateTimer >= HURT_STAGGER_DURATION ? "advance" : "hurt";
    case "idle":
      return ctx.hasLineOfSight && ctx.distanceToPlayer <= DETECT_RANGE ? "detect" : "idle";
    case "detect":
      if (!ctx.hasLineOfSight || ctx.distanceToPlayer > DETECT_RANGE) return "idle";
      if (ctx.inAttackRange) return "attack";
      return ctx.stateTimer >= DETECT_REACTION_TIME ? "advance" : "detect";
    case "advance":
      if (ctx.distanceToPlayer > GIVE_UP_RANGE) return "idle";
      if (ctx.inAttackRange) return "attack";
      if (ctx.hasLineOfSight && ctx.chargeReady && ctx.inChargeBand) return "windup";
      return "advance";
    case "windup":
      // 蓄力中止：目標消失於視線或跑到放棄距離外，回 advance 不衝撞（同 Spitter windup 中止慣例）。
      if (!ctx.hasLineOfSight || ctx.distanceToPlayer > GIVE_UP_RANGE) return "advance";
      return ctx.stateTimer >= WARDEN_CHARGE_WINDUP_DURATION ? "charge" : "windup";
    case "charge":
      // 命中提前結束由 update() 直接指定；本函式只處理時間到的正常結束（未命中亦回 advance）。
      return ctx.stateTimer >= WARDEN_CHARGE_DURATION ? "advance" : "charge";
    case "attack":
      return ctx.inAttackRange ? "attack" : "advance";
    default:
      return current;
  }
}

export interface WardenAttackEvent {
  damage: number;
  /** 短暫擊退（世界空間位移量，公尺）：僅衝撞命中才有，一般近戰攻擊為 null。
   *  main.ts 應用同一套逐軸碰撞解算套用在玩家身上，避免擊退穿牆。 */
  knockback: Vec3 | null;
}

export class Warden {
  readonly id: number;
  /** 所屬區域標記（同 Crawler／Spitter 慣例，供 debug／測試分組）。 */
  readonly area?: string;
  /** 腳底位置。 */
  position: Vec3;
  hp = WARDEN_MAX_HP;
  state: WardenState;
  private stateTimer = 0;
  private meleeCooldown = 0;
  private chargeCooldown = 0;
  private hitFlashTimer = 0;
  private elapsedTime = 0;
  private facingYaw = 0;
  /** charge 進入當下鎖定的直線方向（單位向量，水平面），衝撞期間不再轉向（「直線衝撞」）。 */
  private chargeDirX = 0;
  private chargeDirZ = -1;
  /** 本次 charge 是否已命中過玩家（每次進入 charge 重置，避免同一次衝撞多幀重複觸發傷害）。 */
  private chargeHasHit = false;

  constructor(id: number, spawnPosition: Vec3, initialState: WardenState = "idle", area?: string) {
    this.id = id;
    this.position = { ...spawnPosition };
    this.state = initialState;
    this.area = area;
  }

  getCenter(): Vec3 {
    return { x: this.position.x, y: this.position.y + WARDEN_HALF.y, z: this.position.z };
  }

  getAabb(): Aabb {
    const c = this.getCenter();
    return {
      min: { x: c.x - WARDEN_HALF.x, y: c.y - WARDEN_HALF.y, z: c.z - WARDEN_HALF.z },
      max: { x: c.x + WARDEN_HALF.x, y: c.y + WARDEN_HALF.y, z: c.z + WARDEN_HALF.z },
    };
  }

  /** 目前面向 yaw（弧度），供 renderer 端建立含旋轉的 model matrix，也供方向性減傷判定使用。 */
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

  /** 蓄力進度 0（未蓄力）至 1（即將衝撞），供 renderer 端增強橘光 telegraph（同 Spitter 慣例）；
   *  非 windup 時回 0。 */
  get telegraphIntensity(): number {
    if (this.state !== "windup") return 0;
    return Math.min(1, this.stateTimer / WARDEN_CHARGE_WINDUP_DURATION);
  }

  /**
   * 套用傷害；hitDirection（可選）為攻擊行進方向（單位向量，供方向性減傷判定，見檔頭註解）。
   * 未提供 hitDirection（例如 debug.clearArea() 的一擊必殺）視為非正面命中，全額傷害。
   * 回傳是否為致命一擊（觸發 Dead 狀態）。已死亡則忽略並回傳 false。
   */
  applyDamage(amount: number, hitDirection?: Vec3): boolean {
    if (this.state === "dead") return false;
    const applied = hitDirection && isFrontHit(hitDirection, this.facingYaw) ? amount * WARDEN_FRONT_DAMAGE_MULTIPLIER : amount;
    this.hp = Math.max(0, this.hp - applied);
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
    const rx = resolveAxisMove(c, WARDEN_HALF, "x", moveX, colliders);
    c = { ...c, x: c.x + rx.delta };
    const rz = resolveAxisMove(c, WARDEN_HALF, "z", moveZ, colliders);
    c = { ...c, z: c.z + rz.delta };

    this.position = { x: c.x, y: this.position.y, z: c.z };
  }

  /**
   * 每幀更新：FSM 轉移、advance 逼近移動（小幅漂移）、windup 原地蓄力、charge 直線衝撞
   * （含命中判定與提前結束）、attack 近戰冷卻。回傳本幀是否觸發攻擊事件（近戰或衝撞命中），
   * 無攻擊則回傳 null。
   */
  update(dt: number, playerFeet: Vec3, playerEye: Vec3, colliders: Aabb[]): WardenAttackEvent | null {
    this.stateTimer += dt;
    this.elapsedTime += dt;
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    if (this.state === "dead") return null;

    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.chargeCooldown = Math.max(0, this.chargeCooldown - dt);

    const center = this.getCenter();
    const toPlayer = subVec3(playerFeet, this.position);
    const distance = lengthVec3(toPlayer);
    const withinDetectRange = distance <= DETECT_RANGE;
    const hasLos = withinDetectRange && hasClearLineOfSight(center, playerEye, colliders);

    const ctx: WardenFsmContext = {
      distanceToPlayer: distance,
      hasLineOfSight: hasLos,
      inAttackRange: distance <= ATTACK_RANGE,
      stateTimer: this.stateTimer,
      chargeReady: this.chargeCooldown <= 0,
      inChargeBand: distance >= WARDEN_CHARGE_MIN_RANGE && distance <= WARDEN_CHARGE_MAX_RANGE,
    };

    const prevState = this.state;
    const next = transition(this.state, ctx);
    if (next !== this.state) {
      this.state = next;
      this.stateTimer = 0;
    }

    // 進入 windup 的當下即鎖定衝撞冷卻（承諾點，同 Spitter attackCooldown 在 shoot 當下設定
    // 的慣例精神，但守衛體改在「決定要蓄力」的瞬間就鎖住，避免蓄力中被打斷後立即再次蓄力）。
    if (prevState !== "windup" && this.state === "windup") {
      this.chargeCooldown = WARDEN_CHARGE_COOLDOWN;
    }

    // 進入 charge 的當下鎖定直線方向（不受後續玩家移動影響，「直線衝撞」）並重置命中旗標。
    if (prevState !== "charge" && this.state === "charge") {
      if (distance > 1e-4) {
        this.chargeDirX = toPlayer.x / distance;
        this.chargeDirZ = toPlayer.z / distance;
      }
      this.chargeHasHit = false;
    }

    let attackEvent: WardenAttackEvent | null = null;

    if (this.state === "attack" && this.meleeCooldown <= 0) {
      this.meleeCooldown = WARDEN_MELEE_INTERVAL;
      attackEvent = { damage: WARDEN_MELEE_DAMAGE, knockback: null };
    }

    // 移動與朝向：dt<=0（例如 debug.setFreezeFx 凍結畫面）時完全略過，同 Crawler／Spitter 慣例。
    if (dt > 0) {
      if (this.state === "charge") {
        // 直線衝撞：忽略即時玩家位置，沿鎖定方向前進（面向已於進入 charge 時鎖定，不再更新）。
        this.moveOnly(this.chargeDirX, this.chargeDirZ, WARDEN_CHARGE_SPEED, dt, colliders, this.getCenter());

        if (!this.chargeHasHit) {
          const distNow = lengthVec3(subVec3(playerFeet, this.position));
          if (distNow <= CHARGE_HIT_RANGE) {
            this.chargeHasHit = true;
            attackEvent = {
              damage: WARDEN_CHARGE_DAMAGE,
              knockback: { x: this.chargeDirX * WARDEN_KNOCKBACK_DISTANCE, y: 0, z: this.chargeDirZ * WARDEN_KNOCKBACK_DISTANCE },
            };
            // 命中即提前結束衝撞回 advance（直接指定，同 Crawler「攻擊命中即後撤」直接指定
            // retreat 的慣例，略過 transition() 的 charge 分支）。
            this.state = "advance";
            this.stateTimer = 0;
          }
        }
      } else if (distance > 1e-4 && this.state !== "hurt" && this.state !== "dead") {
        const towardX = toPlayer.x / distance;
        const towardZ = toPlayer.z / distance;
        this.facingYaw = yawFromDirectionXZ(towardX, towardZ);

        if (this.state === "advance") {
          // 決定性鐵則：只用敵人 id（相位）與模擬累計時間，禁止 Math.random 與時鐘。
          // 「緩慢逼近，決定性漂移幅度小」：漂移角度上限明顯小於 Crawler。
          const phase = this.id * ADVANCE_DRIFT_ID_PHASE_SCALE;
          const driftAngle = Math.sin(this.elapsedTime * ADVANCE_DRIFT_ANGULAR_FREQUENCY + phase) * ADVANCE_DRIFT_MAX_RADIANS;
          const cosA = Math.cos(driftAngle);
          const sinA = Math.sin(driftAngle);
          const dirX = towardX * cosA - towardZ * sinA;
          const dirZ = towardX * sinA + towardZ * cosA;
          this.moveOnly(dirX, dirZ, WARDEN_SPEED, dt, colliders, this.getCenter());
        }
      }
    }

    return attackEvent;
  }
}
