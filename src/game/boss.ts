// 首領「核心守護者」（PLAN §3.4：HP 450、定點加平台移動、三攻擊模式，場地含掩體）。M3 第三
// 階段最終戰。不同於 Crawler／Spitter／Warden 的巡邏型 FSM：核心守護者是「定點」首領，
// 不主動追擊也不受擊硬直（全身可打無方向減傷，與守衛體的正面減傷機制區隔），只在固定平台點
// 之間轉移，並按固定順序循環三種攻擊模式：
//
//   彈幕掃射（barrage）→ 平台轉移（reposition）→ 召喚巡行體（summon）→ 平台轉移 →
//   全場脈衝震波（shockwave-telegraph → 引爆）→ 平台轉移 → （循環回彈幕掃射）……
//
// 模式順序本身固定不變（本次派工規格：「模式順序決定性」），隨 HP 門檻（60%／30%）加壓的是
// 每個模式內的參數（彈幕發數、彈幕發射間隔、平台轉移時長），不是順序本身，見 escalationTier／
// escalationParams。平台選點決定性：建構時以 stream('boss.rng') 建立本體專屬 rng（同 seed 兩次
// 建構逐位元相同序列），reposition 時呼叫 pickNextPlatformIndex() 抽一次值，並保證不連續選中
// 同一平台（「確實移動」）。
//
// 決定性鐵則：本檔全程禁止 Math.random／Date，僅使用建構時取得的單一 rng 串流（見上）。
// 本檔刻意不 import procgen/mesh（邏輯層與外觀層解耦，同 Crawler／Spitter／Warden 慣例）。

import type { Vec3 } from "../core/math.ts";
import { subVec3, lengthVec3 } from "../core/math.ts";
import type { Aabb } from "../procgen/level/level.ts";
import { hasClearLineOfSight } from "./collision.ts";
import { stream, type Rng } from "../rng/rng.ts";

export type BossState = "inactive" | "barrage" | "summon" | "shockwave-telegraph" | "reposition" | "dead";
export type BossAttackMode = "barrage" | "summon" | "shockwave";

export const BOSS_NAME = "核心守護者";
export const BOSS_MAX_HP = 450; // PLAN §3.4（2026-08-05 由 900 砍半，Lin 實玩回饋；加壓門檻為百分比制不受影響）

// ---- 彈幕掃射 ----
export const BARRAGE_ROUND_COUNT_BASE = 8; // PLAN §3.4：8 至 12 發一輪
export const BARRAGE_ROUND_COUNT_TIER1 = 10;
export const BARRAGE_ROUND_COUNT_TIER2 = 12;
export const BARRAGE_ROUND_INTERVAL_BASE = 0.15; // 秒／發
export const BARRAGE_ROUND_INTERVAL_TIER1 = 0.12;
export const BARRAGE_ROUND_INTERVAL_TIER2 = 0.1;
export const BARRAGE_PROJECTILE_SPEED = 10; // m/s（本次派工規格）
export const BARRAGE_PROJECTILE_DAMAGE = 10; // 單發傷害（本次派工規格）
export const BARRAGE_ARC_DEGREES = 50; // 扇形總角度（本次派工規格）

// ---- 召喚巡行體 ----
export const SUMMON_COUNT_MIN = 2; // PLAN §3.4：一次 2 至 3 隻
export const SUMMON_COUNT_MAX = 3;
export const MAX_SUMMONED_ALIVE = 4; // 場上召喚物上限（PLAN §3.4：超過不再召喚）
export const SUMMON_STATE_DURATION = 0.6; // 秒，召喚動作的最短停留時間（節奏用，非規格硬值）

// ---- 全場脈衝震波 ----
export const SHOCKWAVE_TELEGRAPH_DURATION = 1.2; // 秒（PLAN §3.4）
export const SHOCKWAVE_DAMAGE = 30; // PLAN §3.4（躲到掩體後無視線即免傷，見 update() LOS 判定）

// ---- 平台轉移 ----
export const REPOSITION_DURATION_BASE = 1.0; // 秒（潛入谷底再浮出的過場時長，本次派工規格）
export const REPOSITION_DURATION_TIER1 = 0.8;
export const REPOSITION_DURATION_TIER2 = 0.6;

// ---- HP 門檻（PLAN §3.4：HP 低於 60% 與 30% 時加壓）----
export const HP_THRESHOLD_TIER1 = 0.6;
export const HP_THRESHOLD_TIER2 = 0.3;

const HIT_FLASH_DURATION = 0.1; // 秒，同其餘敵人慣例
/** 死亡序列時長（核心過載視覺，PLAN §4.4：「全場閃白漸強約 2 秒」），main.ts 的真結局流程
 *  以此常數為準，同步驅動螢幕閃白與本體溶解進度。 */
export const BOSS_DEATH_SEQUENCE_DURATION = 2.0;

/** 命中判定尺寸（本次派工規格：「明顯大於一切敵人（約 3m）」，2×BOSS_HALF.y=3m）。 */
export const BOSS_HALF: Vec3 = { x: 1.3, y: 1.5, z: 1.2 };

const ATTACK_MODE_ORDER: readonly BossAttackMode[] = ["barrage", "summon", "shockwave"];

/** HP 門檻加壓等級：0（>60%）／1（30%～60%）／2（<30%）。 */
export function escalationTier(hpRatio: number): 0 | 1 | 2 {
  if (hpRatio < HP_THRESHOLD_TIER2) return 2;
  if (hpRatio < HP_THRESHOLD_TIER1) return 1;
  return 0;
}

export interface BossEscalationParams {
  roundCount: number;
  roundInterval: number;
  repositionDuration: number;
}

/** 純函式：依加壓等級回傳對應的彈幕發數／發射間隔／平台轉移時長。供單元測試逐條鎖定。 */
export function escalationParams(tier: 0 | 1 | 2): BossEscalationParams {
  if (tier === 2) {
    return { roundCount: BARRAGE_ROUND_COUNT_TIER2, roundInterval: BARRAGE_ROUND_INTERVAL_TIER2, repositionDuration: REPOSITION_DURATION_TIER2 };
  }
  if (tier === 1) {
    return { roundCount: BARRAGE_ROUND_COUNT_TIER1, roundInterval: BARRAGE_ROUND_INTERVAL_TIER1, repositionDuration: REPOSITION_DURATION_TIER1 };
  }
  return { roundCount: BARRAGE_ROUND_COUNT_BASE, roundInterval: BARRAGE_ROUND_INTERVAL_BASE, repositionDuration: REPOSITION_DURATION_BASE };
}

/** 純函式：依循環序號決定性回傳該輪攻擊模式（本次派工規格：模式順序固定循環，不受 HP 影響）。 */
export function attackModeForCycle(cycleIndex: number): BossAttackMode {
  return ATTACK_MODE_ORDER[((cycleIndex % ATTACK_MODE_ORDER.length) + ATTACK_MODE_ORDER.length) % ATTACK_MODE_ORDER.length];
}

/**
 * 純函式：依 rng 抽一個平台索引，並保證不連續選中同一平台（「確實移動」，本次派工規格）。
 * platformCount ≤ 1 時恆回 0。供單元測試以固定 rng 驗證決定性與「不重複」不變量。
 */
export function pickNextPlatformIndex(rng: Rng, currentIndex: number, platformCount: number): number {
  if (platformCount <= 1) return 0;
  let next = Math.floor(rng() * platformCount);
  if (next >= platformCount) next = platformCount - 1;
  if (next < 0) next = 0;
  if (next === currentIndex) next = (next + 1) % platformCount;
  return next;
}

/**
 * 純函式：以 baseDir（水平單位向量 {x,z}）為中心，展開 count 個涵蓋 totalArcDegrees 扇形角度、
 * 等角間距的水平方向向量（y=0）。count=1 時回傳單一 baseDir。供單元測試驗證對稱性與角度分布。
 */
export function fanDirections(baseDir: { x: number; z: number }, count: number, totalArcDegrees: number): Vec3[] {
  const baseAngle = Math.atan2(baseDir.x, baseDir.z);
  const halfArc = (totalArcDegrees * Math.PI) / 180 / 2;
  const dirs: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = baseAngle - halfArc + t * 2 * halfArc;
    dirs.push({ x: Math.sin(angle), y: 0, z: Math.cos(angle) });
  }
  return dirs;
}

function yawFromDirectionXZ(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, -dirZ);
}

export interface BossBarrageSpawn {
  pos: Vec3;
  /** 已正規化的水平方向（單位向量）。 */
  dir: Vec3;
  speed: number;
  damage: number;
}

export interface BossUpdateResult {
  /** 本幀應產生的彈幕投射物（可能同幀多發，見 barrage 狀態的追趕迴圈）。 */
  barrageEvents: BossBarrageSpawn[];
  /** 本幀是否應召喚巡行體，count 為實際應召喚數量（已扣除 MAX_SUMMONED_ALIVE 上限，
   *  超過上限時為 0，呼叫端可視 count===0 略過召喚但不需特殊處理）。 */
  summonRequest: { count: number } | null;
  /** 本幀是否引爆震波（含 LOS 判定結果：hasClearLineOfSight 為 false（掩體遮蔽）時
   *  damage 仍會給，由呼叫端逐一對每個玩家／目標各自判定視線後決定是否套用傷害；
   *  單機關卡只有一名玩家，此處直接由 Boss 內部依 update() 傳入的 playerEye／colliders
   *  判定後只在確實命中時才回傳非 null，未命中（掩體後）則為 null）。 */
  shockwaveEvent: { damage: number } | null;
}

export class Boss {
  /** 腳底位置（首領目前所在平台的世界座標，reposition 完成瞬間更新）。 */
  position: Vec3;
  hp = BOSS_MAX_HP;
  state: BossState = "inactive";
  private stateTimer = 0;
  private hitFlashTimer = 0;
  private facingYaw = 0;

  private readonly rng: Rng;
  private readonly platforms: readonly Vec3[];
  private platformIndex = 0;

  private cycleIndex = 0;
  private roundsTarget = 0;
  private roundsFired = 0;
  private barrageDirs: Vec3[] = [];
  private summonEmitted = false;
  private repositionSwapped = false;

  /**
   * platforms 至少需 1 個元素（PLAN 本次派工規格：4 至 5 個），索引 0 為初始所在點。
   * rngSeedName 預設 'boss.rng'，供測試以不同名稱取得獨立於正式關卡的可重現序列（本次派工規格：
   * 「決定性選點：rng stream 加循環序號」——rng stream 本身即已隨呼叫序（對應循環序號）前進）。
   */
  constructor(platforms: readonly Vec3[], rngSeedName = "boss.rng") {
    this.platforms = platforms.length > 0 ? platforms : [{ x: 0, y: 0, z: 0 }];
    this.position = { ...this.platforms[0] };
    this.rng = stream(rngSeedName);
  }

  getCenter(): Vec3 {
    return { x: this.position.x, y: this.position.y + BOSS_HALF.y, z: this.position.z };
  }

  getAabb(): Aabb {
    const c = this.getCenter();
    return {
      min: { x: c.x - BOSS_HALF.x, y: c.y - BOSS_HALF.y, z: c.z - BOSS_HALF.z },
      max: { x: c.x + BOSS_HALF.x, y: c.y + BOSS_HALF.y, z: c.z + BOSS_HALF.z },
    };
  }

  get yaw(): number {
    return this.facingYaw;
  }

  get hitFlashIntensity(): number {
    return this.hitFlashTimer / HIT_FLASH_DURATION;
  }

  /** 蓄力進度 0（未蓄力）至 1（即將引爆），供 renderer 端警示橘弱點增強，也供 main.ts 驅動
   *  HUD 全場紅光 telegraph（同一份數值，見類別頭註解）；非 shockwave-telegraph 時回 0。 */
  get telegraphIntensity(): number {
    if (this.state !== "shockwave-telegraph") return 0;
    return Math.min(1, this.stateTimer / SHOCKWAVE_TELEGRAPH_DURATION);
  }

  /** 死亡溶解進度，0（剛死）至 1（核心過載完成）；非死亡狀態回傳 0。 */
  get dissolveProgress(): number {
    if (this.state !== "dead") return 0;
    return Math.min(1, this.stateTimer / BOSS_DEATH_SEQUENCE_DURATION);
  }

  /** 潛入／浮出進度（reposition 狀態的視覺用途）：0（平台上）至 1（完全潛入谷底）；
   *  前半程 0→1（潛入），後半程 1→0（浮出，已在新平台）；非 reposition 時回 0。 */
  get diveProgress(): number {
    if (this.state !== "reposition") return 0;
    const tier = escalationTier(this.hp / BOSS_MAX_HP);
    const duration = escalationParams(tier).repositionDuration;
    const half = duration / 2;
    if (this.stateTimer < half) return Math.min(1, this.stateTimer / half);
    return Math.max(0, 1 - (this.stateTimer - half) / half);
  }

  get removable(): boolean {
    return this.state === "dead" && this.stateTimer >= BOSS_DEATH_SEQUENCE_DURATION;
  }

  /** 啟動首領戰（main.ts 於玩家跨入首領大廳、大門鎖住時呼叫一次）；已啟動或已死亡則忽略。 */
  activate(playerFeet: Vec3): void {
    if (this.state !== "inactive") return;
    this.cycleIndex = 0;
    this.enterAttackMode(0, playerFeet);
  }

  /**
   * 套用傷害：全身可打，無方向減傷（與守衛體區隔，忽略 hitDirection）。回傳是否為致命一擊。
   * 已死亡或尚未啟動戰鬥（inactive，理論上不可達，前方大門鎖住不可能被命中）皆忽略。
   */
  applyDamage(amount: number, _hitDirection?: Vec3): boolean {
    if (this.state === "dead" || this.state === "inactive") return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlashTimer = HIT_FLASH_DURATION;
    if (this.hp <= 0) {
      this.state = "dead";
      this.stateTimer = 0;
      return true;
    }
    return false;
  }

  /** debug／測試專用：直接設定 HP（略過 inactive 防呆，供驗收壓 HP 門檻或瞬殺，見
   *  window.__p96.debug.setBossHp）。hp≤0 直接轉 dead。不影響已死亡狀態（避免死亡動畫中被重置）。 */
  setHpDebug(hp: number): void {
    if (this.state === "dead") return;
    this.hp = Math.max(0, hp);
    if (this.hp <= 0) {
      this.state = "dead";
      this.stateTimer = 0;
    }
  }

  private enterAttackMode(cycleIndex: number, playerFeet: Vec3): void {
    const mode = attackModeForCycle(cycleIndex);
    this.stateTimer = 0;
    if (mode === "barrage") {
      this.state = "barrage";
      const tier = escalationTier(this.hp / BOSS_MAX_HP);
      const params = escalationParams(tier);
      this.roundsTarget = params.roundCount;
      this.roundsFired = 0;
      const toPlayer = subVec3(playerFeet, this.position);
      const dist = lengthVec3(toPlayer);
      const baseDir = dist > 1e-4 ? { x: toPlayer.x / dist, z: toPlayer.z / dist } : { x: 0, z: -1 };
      this.barrageDirs = fanDirections(baseDir, this.roundsTarget, BARRAGE_ARC_DEGREES);
      this.facingYaw = yawFromDirectionXZ(baseDir.x, baseDir.z);
    } else if (mode === "summon") {
      this.state = "summon";
      this.summonEmitted = false;
    } else {
      this.state = "shockwave-telegraph";
    }
  }

  private enterReposition(): void {
    this.state = "reposition";
    this.stateTimer = 0;
    this.repositionSwapped = false;
  }

  /**
   * 每幀更新：驅動彈幕／召喚／震波／平台轉移的循環。summonedAliveCount 為呼叫端目前場上
   * 存活的召喚巡行體數（供召喚上限判斷）。dt≤0（debug.setFreezeFx 凍結）時完全略過，
   * 同 Crawler／Spitter／Warden 慣例。
   */
  update(dt: number, playerFeet: Vec3, playerEye: Vec3, colliders: readonly Aabb[], summonedAliveCount: number): BossUpdateResult {
    const result: BossUpdateResult = { barrageEvents: [], summonRequest: null, shockwaveEvent: null };
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    if (dt <= 0) return result;

    this.stateTimer += dt;
    if (this.state === "inactive" || this.state === "dead") return result;

    // 全程面向玩家（除 reposition 潛行中不轉向，視覺上「潛入」時不該還在轉頭）。
    if (this.state !== "reposition") {
      const toPlayer = subVec3(playerFeet, this.position);
      const dist = lengthVec3(toPlayer);
      if (dist > 1e-4) this.facingYaw = yawFromDirectionXZ(toPlayer.x / dist, toPlayer.z / dist);
    }

    const tier = escalationTier(this.hp / BOSS_MAX_HP);
    const params = escalationParams(tier);

    switch (this.state) {
      case "barrage": {
        while (this.roundsFired < this.roundsTarget && this.stateTimer >= this.roundsFired * params.roundInterval) {
          const dir = this.barrageDirs[this.roundsFired];
          result.barrageEvents.push({ pos: this.getCenter(), dir, speed: BARRAGE_PROJECTILE_SPEED, damage: BARRAGE_PROJECTILE_DAMAGE });
          this.roundsFired++;
        }
        if (this.roundsFired >= this.roundsTarget) this.enterReposition();
        break;
      }
      case "summon": {
        if (!this.summonEmitted) {
          this.summonEmitted = true;
          const desired = SUMMON_COUNT_MIN + (this.rng() < 0.5 ? 0 : SUMMON_COUNT_MAX - SUMMON_COUNT_MIN);
          const allowed = Math.max(0, Math.min(desired, MAX_SUMMONED_ALIVE - summonedAliveCount));
          result.summonRequest = { count: allowed };
        }
        if (this.stateTimer >= SUMMON_STATE_DURATION) this.enterReposition();
        break;
      }
      case "shockwave-telegraph": {
        if (this.stateTimer >= SHOCKWAVE_TELEGRAPH_DURATION) {
          const hasLos = hasClearLineOfSight(this.getCenter(), playerEye, colliders as Aabb[]);
          if (hasLos) result.shockwaveEvent = { damage: SHOCKWAVE_DAMAGE };
          this.enterReposition();
        }
        break;
      }
      case "reposition": {
        const half = params.repositionDuration / 2;
        if (!this.repositionSwapped && this.stateTimer >= half) {
          const nextIndex = pickNextPlatformIndex(this.rng, this.platformIndex, this.platforms.length);
          this.platformIndex = nextIndex;
          this.position = { ...this.platforms[nextIndex] };
          this.repositionSwapped = true;
        }
        if (this.stateTimer >= params.repositionDuration) {
          this.cycleIndex++;
          this.enterAttackMode(this.cycleIndex, playerFeet);
        }
        break;
      }
      default:
        break;
    }

    return result;
  }
}
