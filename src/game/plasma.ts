// 電漿步槍：投射物武器（PLAN §3.3：投射物 20 m/s、單發傷害 14、射速 6 發/秒、彈藥上限 180，
// 稀少）。按住連射，射速由冷卻限制（同 weapons.ts／shotgun.ts 慣例）。本檔只管彈藥與冷卻、
// 「該不該發射」的判斷與命中回饋計時器；實際投射物由 main.ts 呼叫 game/projectiles.ts 的
// ProjectileSystem.spawn() 依 tryFire() 回傳的 spawnEvent 產生（沿用 game/spitter.ts
// 「回傳事件，呼叫端建立投射物」的解耦慣例：PlasmaRifle 本身不 import ProjectileSystem，
// 維持與其餘武器同層級的單元測試便利性）。命中判定（含對守衛體的方向性減傷）由
// ProjectileSystem.update() 呼叫 target.applyDamage(amount, hitDirection) 非同步處理，
// 命中發生的當下不在 tryFire() 內，故 triggerHitMarker() 由 main.ts 在收到命中事件時另行呼叫
// （同一顆彈可能數幀後才命中，與 hitscan 武器「開火當下即知道命中結果」不同）。

import type { Vec3 } from "../core/math.ts";
import { normalizeVec3 } from "../core/math.ts";
import { playPlasmaFire } from "../audio/synth.ts";

export const PLASMA_RIFLE_DAMAGE = 14;
export const PLASMA_RIFLE_FIRE_RATE = 6; // 發/秒
export const PLASMA_RIFLE_MAGAZINE = 180;
export const PLASMA_RIFLE_COOLDOWN = 1 / PLASMA_RIFLE_FIRE_RATE;
export const PLASMA_PROJECTILE_SPEED = 20; // m/s（PLAN §3.3）
export const PLASMA_PROJECTILE_RADIUS = 0.12; // m，命中判定容差半徑（同 SPITTER_PROJECTILE_RADIUS 慣例）
/** 能源青（PLAN §5.1 #35E0FF），player 陣營投射物色（本次派工規格）。 */
export const PLASMA_PROJECTILE_COLOR: readonly [number, number, number] = [0x35 / 255, 0xe0 / 255, 0xff / 255];

const HIT_MARKER_DURATION = 0.12; // 秒，同 weapons.ts／shotgun.ts 慣例

export interface PlasmaSpawnEvent {
  pos: Vec3;
  /** 已正規化的射出方向（單位向量）。 */
  dir: Vec3;
  speed: number;
  damage: number;
  radius: number;
  faction: "player";
  color: readonly [number, number, number];
}

export interface PlasmaFireResult {
  fired: boolean;
  /** fired=true 時提供，供呼叫端傳給 ProjectileSystem.spawn()；fired=false 時為 null。 */
  spawnEvent: PlasmaSpawnEvent | null;
}

export class PlasmaRifle {
  ammo = PLASMA_RIFLE_MAGAZINE;
  private cooldownRemaining = 0;
  private hitMarkerRemaining = 0;

  get hitMarkerActive(): boolean {
    return this.hitMarkerRemaining > 0;
  }

  get canFire(): boolean {
    return this.cooldownRemaining <= 0 && this.ammo > 0;
  }

  /** 每幀呼叫一次，遞減冷卻與命中回饋計時器（同其餘武器慣例）。 */
  update(dt: number): void {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    this.hitMarkerRemaining = Math.max(0, this.hitMarkerRemaining - dt);
  }

  /** 重置為滿彈藥、清空冷卻與命中回饋（供死亡重生／重新開始使用）。 */
  reset(): void {
    this.ammo = PLASMA_RIFLE_MAGAZINE;
    this.cooldownRemaining = 0;
    this.hitMarkerRemaining = 0;
  }

  /**
   * 嘗試開火一次：冷卻中或彈藥不足時回傳 fired=false，不消耗任何資源、不觸發音效、
   * spawnEvent 為 null。direction 不需為單位向量（內部會正規化）。
   */
  tryFire(origin: Vec3, direction: Vec3): PlasmaFireResult {
    if (!this.canFire) return { fired: false, spawnEvent: null };

    this.cooldownRemaining = PLASMA_RIFLE_COOLDOWN;
    this.ammo -= 1;
    playPlasmaFire();

    return {
      fired: true,
      spawnEvent: {
        pos: { ...origin },
        dir: normalizeVec3(direction),
        speed: PLASMA_PROJECTILE_SPEED,
        damage: PLASMA_RIFLE_DAMAGE,
        radius: PLASMA_PROJECTILE_RADIUS,
        faction: "player",
        color: PLASMA_PROJECTILE_COLOR,
      },
    };
  }

  /** 供呼叫端在收到本武器發射的投射物命中事件時觸發命中回饋（同 hitscan 武器的
   *  hitMarkerRemaining 賦值慣例，只是觸發時機延後到命中當下而非開火當下）。 */
  triggerHitMarker(): void {
    this.hitMarkerRemaining = HIT_MARKER_DURATION;
  }
}
