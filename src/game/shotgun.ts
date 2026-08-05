// 散射槍：hitscan，每次開火同時射出 6 珠，每珠傷害 8、射速 1.2 發/秒、彈藥上限 48（PLAN §3.3
// 本次派工規格）。近距高傷、走廊利器。散佈由決定性 rng（stream('weapon.scatter.<開火序號>')）
// 決定：同一開火序號兩次呼叫得到逐位元相同的 6 個彈道方向，供單元測試鎖定（PLAN §6.4 決定性
// 鐵則：影響玩法的生成一律 CPU 決定性——散佈方向直接影響命中與傷害，屬玩法資料）。
// 命中判定重用 game/weapons.ts 的 raycastScene（與脈衝手槍共用同一套「先命中者算」邏輯）。

import { stream } from "../rng/rng.ts";
import type { Vec3 } from "../core/math.ts";
import { crossVec3, normalizeVec3 } from "../core/math.ts";
import type { Aabb } from "../procgen/level/level.ts";
import { raycastScene, type HitKind, type Shootable } from "./weapons.ts";
import { playShotgunFire, playHit, playEnemyDie } from "../audio/synth.ts";

export const SCATTER_PELLET_COUNT = 6;
export const SCATTER_PELLET_DAMAGE = 8;
export const SCATTER_FIRE_RATE = 1.2; // 發/秒
export const SCATTER_MAGAZINE = 48;
export const SCATTER_COOLDOWN = 1 / SCATTER_FIRE_RATE;
/** 散佈錐半角（弧度），約 4 度（PLAN 本次派工規格）。 */
export const SCATTER_CONE_HALF_ANGLE = (4 * Math.PI) / 180;

const HIT_MARKER_DURATION = 0.12; // 秒

export interface PelletHit {
  hitEnemy: Shootable | null;
  hitPoint: Vec3;
  hitKind: HitKind;
  /** 本珠是否為致命一擊（見 weapons.ts FireResult.died 同慣例，避免事後檢查 hitEnemy.state
   *  在多珠連續命中同一敵人時誤將非致命珠也算成擊殺）。 */
  died: boolean;
}

export interface ScatterFireResult {
  fired: boolean;
  pellets: PelletHit[];
}

/**
 * 依開火序號（shotIndex）決定性地產生 SCATTER_PELLET_COUNT 個散佈方向：以 forward 為軸的
 * 圓錐內取樣（非嚴格均勻立體角，散射槍近距離散佈不需要精確均勻，決定性與可重現才是重點）。
 */
export function scatterDirections(shotIndex: number, forward: Vec3): Vec3[] {
  const rng = stream(`weapon.scatter.${shotIndex}`);
  const up0: Vec3 = Math.abs(forward.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = normalizeVec3(crossVec3(up0, forward));
  const up = crossVec3(forward, right);

  const cosHalf = Math.cos(SCATTER_CONE_HALF_ANGLE);
  const dirs: Vec3[] = [];
  for (let i = 0; i < SCATTER_PELLET_COUNT; i++) {
    const z = 1 - rng() * (1 - cosHalf);
    const phi = rng() * Math.PI * 2;
    const sinTheta = Math.sqrt(Math.max(0, 1 - z * z));
    const lx = sinTheta * Math.cos(phi);
    const ly = sinTheta * Math.sin(phi);
    const dir: Vec3 = {
      x: right.x * lx + up.x * ly + forward.x * z,
      y: right.y * lx + up.y * ly + forward.y * z,
      z: right.z * lx + up.z * ly + forward.z * z,
    };
    dirs.push(normalizeVec3(dir));
  }
  return dirs;
}

export class ScatterShotgun {
  ammo = SCATTER_MAGAZINE;
  private cooldownRemaining = 0;
  private hitMarkerRemaining = 0;
  private shotIndex = 0;

  get hitMarkerActive(): boolean {
    return this.hitMarkerRemaining > 0;
  }

  get canFire(): boolean {
    return this.cooldownRemaining <= 0 && this.ammo > 0;
  }

  update(dt: number): void {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    this.hitMarkerRemaining = Math.max(0, this.hitMarkerRemaining - dt);
  }

  /** 重置為滿彈藥並歸零開火序號（供死亡重生／重新開始使用，確保散佈序列從頭可重現）。 */
  reset(): void {
    this.ammo = SCATTER_MAGAZINE;
    this.cooldownRemaining = 0;
    this.hitMarkerRemaining = 0;
    this.shotIndex = 0;
  }

  tryFire(origin: Vec3, forward: Vec3, levelColliders: Aabb[], enemies: Shootable[]): ScatterFireResult {
    if (!this.canFire) return { fired: false, pellets: [] };

    this.cooldownRemaining = SCATTER_COOLDOWN;
    this.ammo -= 1;
    playShotgunFire();

    const dirs = scatterDirections(this.shotIndex, forward);
    this.shotIndex += 1;

    let anyEnemyHit = false;
    let anyKill = false;
    const pellets: PelletHit[] = dirs.map((dir) => {
      const hit = raycastScene(origin, dir, levelColliders, enemies);
      let died = false;
      if (hit.hitEnemy) {
        anyEnemyHit = true;
        died = hit.hitEnemy.applyDamage(SCATTER_PELLET_DAMAGE, dir);
        if (died) anyKill = true;
      }
      return { ...hit, died };
    });

    if (anyEnemyHit) {
      this.hitMarkerRemaining = HIT_MARKER_DURATION;
      // 一次扣扳機播一次命中／擊殺音效（避免 6 珠各自疊音造成音量爆表）。
      if (anyKill) playEnemyDie();
      else playHit();
    }

    return { fired: true, pellets };
  }
}
