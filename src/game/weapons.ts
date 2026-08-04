// 脈衝手槍：hitscan、單發傷害 12、射速 3 發/秒、彈藥上限 120（起始滿）（PLAN §3.3）。
// 開火時對關卡碰撞體與敵人 AABB 做 raycast，先命中者算（最近的交點決定命中對象）。
// 記錄命中回饋的計時器供準星讀取顯示；槍口閃光／後座／tracer／火花等 viewmodel 特效改由
// game/effects.ts 的獨立狀態機管理（main.ts 依 FireResult 觸發），本檔只管遊戲邏輯本身。
//
// 2026-08-04 平衡調整：對敵人的 raycast 判定加入瞄準寬容（AIM_ASSIST_MARGIN，敵人 AABB
// 各軸外擴 0.18m），只影響「武器對敵人」的命中判定，不影響對關卡幾何的判定、不影響敵人
// 自身的移動碰撞範圍（見 game/enemy.ts CRAWLER_HALF）。根因：Lin 實玩回饋「怪物太強打不死」，
// 觸控板瞄準精度不如滑鼠，加上命中回饋不夠明顯，讓玩家誤以為命中判定失靈。FireResult 另
// 補上 hitPoint／hitKind（命中點與命中種類），供 tracer／火花特效取用實際世界座標。

import type { Vec3 } from "../core/math.ts";
import type { Aabb } from "../procgen/level/level.ts";
import { rayAabbIntersect, expandAabb } from "./collision.ts";
import { Crawler } from "./enemy.ts";
import { playShoot, playHit, playEnemyDie } from "../audio/synth.ts";

export const PULSE_PISTOL_DAMAGE = 12;
export const PULSE_PISTOL_FIRE_RATE = 3; // 發/秒
export const PULSE_PISTOL_MAGAZINE = 120;
export const PULSE_PISTOL_COOLDOWN = 1 / PULSE_PISTOL_FIRE_RATE;

const HIT_MARKER_DURATION = 0.12; // 秒
const MAX_RANGE = 100; // m
/** 武器對敵人 raycast 的瞄準寬容：敵人 AABB 各軸外擴量（公尺）。 */
export const AIM_ASSIST_MARGIN = 0.18;

export type HitKind = "enemy" | "wall" | "none";

export interface FireResult {
  fired: boolean;
  hitEnemy: Crawler | null;
  /** 命中點世界座標；fired=false 時為 null，未命中任何東西則為射線終點（MAX_RANGE 處）。 */
  hitPoint: Vec3 | null;
  hitKind: HitKind;
  /** 本次命中是否為致命一擊（M2 新增，供 main.ts 累計擊殺數；不可由事後檢查 hitEnemy.state
   *  推得——多發／多珠情境下敵人可能在本次以前就已死亡，見 shotgun.ts PelletHit 同慣例）。 */
  died: boolean;
}

export interface RaycastHit {
  hitEnemy: Crawler | null;
  hitPoint: Vec3;
  hitKind: HitKind;
}

/**
 * 共用的場景 raycast：關卡幾何與敵人（皆以「先命中者算」比對交點 t）取最近者。
 * 敵人 AABB 外擴 AIM_ASSIST_MARGIN 做瞄準寬容（見檔頭註解），供 PulsePistol／ScatterShotgun
 * 共用，避免同一段命中判定邏輯在兩把武器各自重複一份（M2 新增散射槍時抽出）。
 */
export function raycastScene(origin: Vec3, direction: Vec3, levelColliders: Aabb[], enemies: Crawler[]): RaycastHit {
  let nearestT = MAX_RANGE;
  let nearestEnemy: Crawler | null = null;

  for (const collider of levelColliders) {
    const t = rayAabbIntersect(origin, direction, collider);
    if (t !== null && t < nearestT) {
      nearestT = t;
      nearestEnemy = null;
    }
  }

  for (const enemy of enemies) {
    if (enemy.state === "dead") continue;
    const expanded = expandAabb(enemy.getAabb(), AIM_ASSIST_MARGIN);
    const t = rayAabbIntersect(origin, direction, expanded);
    if (t !== null && t < nearestT) {
      nearestT = t;
      nearestEnemy = enemy;
    }
  }

  const hitKind: HitKind = nearestEnemy ? "enemy" : nearestT < MAX_RANGE ? "wall" : "none";
  const hitPoint: Vec3 = {
    x: origin.x + direction.x * nearestT,
    y: origin.y + direction.y * nearestT,
    z: origin.z + direction.z * nearestT,
  };
  return { hitEnemy: nearestEnemy, hitPoint, hitKind };
}

export class PulsePistol {
  ammo = PULSE_PISTOL_MAGAZINE;
  private cooldownRemaining = 0;
  private hitMarkerRemaining = 0;

  get hitMarkerActive(): boolean {
    return this.hitMarkerRemaining > 0;
  }

  get canFire(): boolean {
    return this.cooldownRemaining <= 0 && this.ammo > 0;
  }

  /** 每幀呼叫一次，遞減各計時器（冷卻、命中回饋）。 */
  update(dt: number): void {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    this.hitMarkerRemaining = Math.max(0, this.hitMarkerRemaining - dt);
  }

  /** 重置為滿彈藥、清空所有計時器（供死亡重生時使用，PLAN M1 AC：彈藥從種子重建）。 */
  reset(): void {
    this.ammo = PULSE_PISTOL_MAGAZINE;
    this.cooldownRemaining = 0;
    this.hitMarkerRemaining = 0;
  }

  /**
   * 嘗試開火一次：冷卻中或彈藥不足時回傳 fired=false，不消耗任何資源、不觸發音效。
   * direction 需為單位向量（camera forward）。
   */
  tryFire(origin: Vec3, direction: Vec3, levelColliders: Aabb[], enemies: Crawler[]): FireResult {
    if (!this.canFire) return { fired: false, hitEnemy: null, hitPoint: null, hitKind: "none", died: false };

    this.cooldownRemaining = PULSE_PISTOL_COOLDOWN;
    this.ammo -= 1;
    playShoot();

    const { hitEnemy, hitPoint, hitKind } = raycastScene(origin, direction, levelColliders, enemies);

    let died = false;
    if (hitEnemy) {
      died = hitEnemy.applyDamage(PULSE_PISTOL_DAMAGE);
      this.hitMarkerRemaining = HIT_MARKER_DURATION;
      if (died) {
        playEnemyDie();
      } else {
        playHit();
      }
    }

    return { fired: true, hitEnemy, hitPoint, hitKind, died };
  }
}

export type WeaponId = "pistol" | "shotgun";
