// 巡行體 FSM 與移動：Idle → Detect（距離加視線）→ Chase → Attack → Retreat（攻擊命中後短暫
// 後撤，不黏身）→ Chase；或 Hurt（短暫硬直）→ Chase；或 Dead（溶解淡出後移除）。
// 數值取自 PLAN §3.4 v4：HP 24（手槍 12 傷兩發擊殺）、速度 2.2 m/s（殭屍蹣跚，玩家 6.0 m/s
// 可拉開距離）、近戰傷害 10、攻擊間隔 0.8 秒。移動對關卡 AABB 碰撞，重用 game/collision.ts
// 的逐軸解算（與 player.ts 同一套邏輯）。
// 2026-08-04 平衡調整：HP 30→24（Lin 實玩回饋「怪物太強打不死」，根因為觸控板瞄準困難加
// 命中回饋不可見，本檔另補 hitFlash 視覺回饋，瞄準寬容見 game/weapons.ts／game/collision.ts）。
// 2026-08-04 v4 去磁鐵化（Lin 實玩 M1 draft 回饋）：巡行體先前會直線導彈式撲身、攻擊命中後
// 仍貼身連續攻擊，體感像磁鐵吸附。本輪加入 retreat 狀態（攻擊命中後強制後撤，略過 transition()
// 的 attack 分支直接指定，與 applyDamage() 直接指定 hurt／dead 同慣例）與 chase 橫向漂移遊走
// （只用敵人 id 與模擬累計時間，決定性，禁止 Math.random 與時鐘），並把黏著度相關參數集中
// 成具名常數供難度曲線調整（PLAN §3.5）。

import type { Vec3 } from "../core/math.ts";
import { subVec3, lengthVec3 } from "../core/math.ts";
import type { Aabb } from "../procgen/level/room.ts";
import { resolveAxisMove, hasClearLineOfSight } from "./collision.ts";

export type EnemyState = "idle" | "detect" | "chase" | "attack" | "retreat" | "hurt" | "dead";

export const CRAWLER_MAX_HP = 24;
export const CRAWLER_SPEED = 2.2; // m/s，殭屍蹣跚步態（PLAN §3.4 v4；玩家 6.0 m/s 可拉開距離）
export const CRAWLER_MELEE_DAMAGE = 10;

// 難度旋鈕，後段關卡上調（PLAN §3.5：黏著度＝後撤頻率與距離、移動速度為難度曲線主要旋鈕，
// 前段關卡取低黏著度低速度，後段逐步上調；數值集中於此供逐區調整）。
export const CRAWLER_ATTACK_INTERVAL = 0.8; // 秒，近戰攻擊之間的最小冷卻間隔
export const RETREAT_DURATION = 1.2; // 秒，攻擊命中後的後撤時長（PLAN §3.4 v4：1.0～1.5 秒區間）
export const RETREAT_SPEED = 1.6; // m/s，後撤移動速度
export const CHASE_DRIFT_MAX_RADIANS = (35 * Math.PI) / 180; // 追擊橫向漂移最大偏擺角，約 ±35 度
export const CHASE_DRIFT_PERIOD_SECONDS = 3.2; // 漂移週期（秒），步態像遊走而非直線導彈

const DETECT_RANGE = 12; // m
const CHASE_GIVE_UP_RANGE = 20; // m，追丟後放棄追擊的距離
const ATTACK_RANGE = 1.5; // m，隨新體型微調（雙臂前伸，胸寬 0.35→0.3m 但手臂前伸增加觸及距離）
const DETECT_REACTION_TIME = 0.3; // 秒，Detect 停留才轉 Chase（給玩家反應空檔）
const HURT_STAGGER_DURATION = 0.25; // 秒
const DEATH_DISSOLVE_DURATION = 1.2; // 秒，溶解淡出動畫時長，之後才視為可移除
const HIT_FLASH_DURATION = 0.1; // 秒，受擊整體閃亮回饋（renderer 端讀 hitFlashIntensity 混白）

// 漂移相位縮放（非難度旋鈕，純技術細節）：讓不同 id 的個體漂移相位錯開，避免群體同步擺動、
// 一眼看出是群聚魚群式擺動而非各自遊走。純敵人 id 的函式，決定性。
const CHASE_DRIFT_ID_PHASE_SCALE = 1.7; // 弧度／每 id
const CHASE_DRIFT_ANGULAR_FREQUENCY = (2 * Math.PI) / CHASE_DRIFT_PERIOD_SECONDS;

/** 敵人碰撞／命中判定半徑（與視覺模型尺寸解耦，類似 player.ts 的 PLAYER_HALF 慣例）。
 *  PLAN §3.4 v4：胸口正對準星高度，站立總高約 1.7m（= 2 × CRAWLER_HALF.y）。 */
export const CRAWLER_HALF: Vec3 = { x: 0.3, y: 0.85, z: 0.3 };

export interface FsmContext {
  distanceToPlayer: number;
  hasLineOfSight: boolean;
  inAttackRange: boolean;
  /** 已在目前狀態停留的秒數。 */
  stateTimer: number;
}

/** 由移動方向（水平面單位向量）反推面向 yaw，與 core/math.ts forwardFromYawPitch 同慣例
 *  （yaw 0 朝 -Z）：forward.xz = (-sin(yaw), -cos(yaw))，故 yaw = atan2(-dirX, -dirZ)。 */
function yawFromDirectionXZ(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, -dirZ);
}

/**
 * 純函式 FSM 轉移表：給定目前狀態與情境，回傳下一狀態，不含副作用，
 * 方便單元測試逐條驗證決定性（同輸入必同輸出）。hurt／dead／retreat 的「進入」由
 * Crawler.applyDamage() 與 Crawler.update() 的近戰命中事件直接設定（與本函式的離開判斷
 * 分工，見 update() 內註解），本函式只負責之後的離開判斷，以及 idle/detect/chase/attack
 * 之間的巡邏轉移。
 */
export function transition(current: EnemyState, ctx: FsmContext): EnemyState {
  switch (current) {
    case "dead":
      return "dead";
    case "hurt":
      return ctx.stateTimer >= HURT_STAGGER_DURATION ? "chase" : "hurt";
    case "retreat":
      return ctx.stateTimer >= RETREAT_DURATION ? "chase" : "retreat";
    case "idle":
      return ctx.hasLineOfSight && ctx.distanceToPlayer <= DETECT_RANGE ? "detect" : "idle";
    case "detect":
      if (!ctx.hasLineOfSight || ctx.distanceToPlayer > DETECT_RANGE) return "idle";
      if (ctx.inAttackRange) return "attack";
      return ctx.stateTimer >= DETECT_REACTION_TIME ? "chase" : "detect";
    case "chase":
      if (ctx.inAttackRange) return "attack";
      if (ctx.distanceToPlayer > CHASE_GIVE_UP_RANGE) return "idle";
      return "chase";
    case "attack":
      return ctx.inAttackRange ? "attack" : "chase";
    default:
      return current;
  }
}

export interface CrawlerAttackEvent {
  damage: number;
}

export class Crawler {
  readonly id: number;
  /** 腳底位置。 */
  position: Vec3;
  hp = CRAWLER_MAX_HP;
  state: EnemyState = "idle";
  private stateTimer = 0;
  private attackCooldown = 0;
  private hitFlashTimer = 0;
  /** 模擬累計時間（非狀態計時器，跨狀態轉移不重置），供 chase 橫向漂移的決定性相位使用。 */
  private elapsedTime = 0;
  /** 面向 yaw（弧度），只在實際移動（chase／retreat）時更新，供 renderer 端旋轉模型。 */
  private facingYaw = 0;

  constructor(id: number, spawnPosition: Vec3) {
    this.id = id;
    this.position = { ...spawnPosition };
  }

  getCenter(): Vec3 {
    return { x: this.position.x, y: this.position.y + CRAWLER_HALF.y, z: this.position.z };
  }

  getAabb(): Aabb {
    const c = this.getCenter();
    return {
      min: { x: c.x - CRAWLER_HALF.x, y: c.y - CRAWLER_HALF.y, z: c.z - CRAWLER_HALF.z },
      max: { x: c.x + CRAWLER_HALF.x, y: c.y + CRAWLER_HALF.y, z: c.z + CRAWLER_HALF.z },
    };
  }

  /** 目前面向 yaw（弧度），供 renderer 端建立含旋轉的 model matrix（身體朝移動方向）。 */
  get yaw(): number {
    return this.facingYaw;
  }

  /** 是否已可從場景移除（死亡且溶解動畫已播完）。 */
  get removable(): boolean {
    return this.state === "dead" && this.stateTimer >= DEATH_DISSOLVE_DURATION;
  }

  /** 死亡溶解進度，0（剛死）至 1（完全溶解）；非死亡狀態回傳 0，供渲染淡出用。 */
  get dissolveProgress(): number {
    if (this.state !== "dead") return 0;
    return Math.min(1, this.stateTimer / DEATH_DISSOLVE_DURATION);
  }

  /** 受擊閃光強度，0（無）至 1（剛受擊）；供 renderer 端把敵人整體混白 0.1 秒當命中回饋。 */
  get hitFlashIntensity(): number {
    return this.hitFlashTimer / HIT_FLASH_DURATION;
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

  /** 沿水平面移動一步（對關卡 AABB 碰撞逐軸解算）並依實際移動方向更新面向 yaw。
   *  dirX／dirZ 需為單位向量（chase 的漂移旋轉、retreat 的反向皆已正規化）。 */
  private moveAndFace(dirX: number, dirZ: number, speed: number, dt: number, colliders: Aabb[], center: Vec3): void {
    const moveX = dirX * speed * dt;
    const moveZ = dirZ * speed * dt;

    let c = center;
    const rx = resolveAxisMove(c, CRAWLER_HALF, "x", moveX, colliders);
    c = { ...c, x: c.x + rx.delta };
    const rz = resolveAxisMove(c, CRAWLER_HALF, "z", moveZ, colliders);
    c = { ...c, z: c.z + rz.delta };

    this.position = { x: c.x, y: this.position.y, z: c.z };
    this.facingYaw = yawFromDirectionXZ(dirX, dirZ);
  }

  /**
   * 每幀更新：FSM 轉移、追擊移動（對關卡 AABB 碰撞，維持在原地板高度不做垂直運動）、
   * 近戰攻擊冷卻。回傳本幀是否觸發近戰攻擊（供呼叫端對玩家造成傷害），無攻擊則回傳 null。
   */
  update(dt: number, playerFeet: Vec3, playerEye: Vec3, colliders: Aabb[]): CrawlerAttackEvent | null {
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

    const ctx: FsmContext = {
      distanceToPlayer: distance,
      hasLineOfSight: hasLos,
      inAttackRange: distance <= ATTACK_RANGE,
      stateTimer: this.stateTimer,
    };

    const next = transition(this.state, ctx);
    if (next !== this.state) {
      this.state = next;
      this.stateTimer = 0;
    }

    let attackEvent: CrawlerAttackEvent | null = null;
    if (this.state === "attack" && this.attackCooldown <= 0) {
      this.attackCooldown = CRAWLER_ATTACK_INTERVAL;
      attackEvent = { damage: CRAWLER_MELEE_DAMAGE };
      // 攻擊命中即後撤，不黏身（PLAN §3.4 v4 去磁鐵化）：直接指定 retreat，略過 transition()
      // 的 attack 分支，與 applyDamage() 直接指定 hurt／dead 同慣例（見上方函式註解）。
      this.state = "retreat";
      this.stateTimer = 0;
    }

    // 移動與朝向：chase 朝玩家逼近並疊加橫向漂移遊走（去磁鐵化，步態像遊走非直線導彈）；
    // retreat 背向玩家直線後撤；attack 原地揮擊不移動；idle／detect／hurt／dead 不移動。
    // dt<=0（例如 debug.setFreezeFx 凍結畫面）時完全略過：面向與位置都不應在「時間停止」時
    // 還因為玩家（鏡頭）位置改變而重新轉向。
    if (dt > 0 && distance > 1e-4) {
      const towardX = toPlayer.x / distance;
      const towardZ = toPlayer.z / distance;

      if (this.state === "chase") {
        // 決定性鐵則：只用敵人 id（相位）與模擬累計時間，禁止 Math.random 與時鐘。
        const phase = this.id * CHASE_DRIFT_ID_PHASE_SCALE;
        const driftAngle = Math.sin(this.elapsedTime * CHASE_DRIFT_ANGULAR_FREQUENCY + phase) * CHASE_DRIFT_MAX_RADIANS;
        const cosA = Math.cos(driftAngle);
        const sinA = Math.sin(driftAngle);
        const dirX = towardX * cosA - towardZ * sinA;
        const dirZ = towardX * sinA + towardZ * cosA;
        this.moveAndFace(dirX, dirZ, CRAWLER_SPEED, dt, colliders, center);
      } else if (this.state === "retreat") {
        this.moveAndFace(-towardX, -towardZ, RETREAT_SPEED, dt, colliders, center);
      }
    }

    return attackEvent;
  }
}
