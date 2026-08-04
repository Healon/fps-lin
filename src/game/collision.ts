// 玩家與敵人共用的碰撞工具：AABB 重疊測試、逐軸解算移動（M0 player.ts 邏輯抽出並重用於敵人），
// 以及 ray-AABB 交點測試（武器 hitscan 與敵人視線判定共用）。

import type { Vec3 } from "../core/math.ts";
import type { Aabb } from "../procgen/level/level.ts";

export function aabbOverlap(aMin: Vec3, aMax: Vec3, bMin: Vec3, bMax: Vec3): boolean {
  return (
    aMin.x < bMax.x &&
    aMax.x > bMin.x &&
    aMin.y < bMax.y &&
    aMax.y > bMin.y &&
    aMin.z < bMax.z &&
    aMax.z > bMin.z
  );
}

export type Axis = "x" | "y" | "z";

/**
 * 沿單一軸移動並解算碰撞：以完整位移量做廣義判定，命中時把該軸位移量夾在
 * 碰到邊界之前（標準的逐軸 AABB 解算，適合本專案的低速場景，不做完整 swept AABB）。
 */
export function resolveAxisMove(
  center: Vec3,
  half: Vec3,
  axis: Axis,
  delta: number,
  colliders: Aabb[],
): { delta: number; hit: boolean } {
  if (delta === 0) return { delta: 0, hit: false };

  const moved: Vec3 = { ...center, [axis]: center[axis] + delta };
  const movedMin: Vec3 = { x: moved.x - half.x, y: moved.y - half.y, z: moved.z - half.z };
  const movedMax: Vec3 = { x: moved.x + half.x, y: moved.y + half.y, z: moved.z + half.z };

  let clampedDelta = delta;
  let hit = false;

  for (const collider of colliders) {
    if (!aabbOverlap(movedMin, movedMax, collider.min, collider.max)) continue;

    if (delta > 0) {
      const allowed = collider.min[axis] - half[axis] - center[axis];
      if (allowed < clampedDelta) clampedDelta = Math.max(0, allowed);
    } else {
      const allowed = collider.max[axis] + half[axis] - center[axis];
      if (allowed > clampedDelta) clampedDelta = Math.min(0, allowed);
    }
    hit = true;
  }

  return { delta: clampedDelta, hit };
}

/**
 * 將 AABB 各軸向外擴張 margin（公尺）。供武器 hitscan 對敵人的瞄準寬容使用
 * （只套用於武器對敵人的命中判定，不影響關卡幾何判定或敵人自身的移動碰撞）。
 */
export function expandAabb(aabb: Aabb, margin: number): Aabb {
  return {
    min: { x: aabb.min.x - margin, y: aabb.min.y - margin, z: aabb.min.z - margin },
    max: { x: aabb.max.x + margin, y: aabb.max.y + margin, z: aabb.max.z + margin },
  };
}

/**
 * Ray-AABB 交點測試（slab method）。direction 需為單位向量。
 * 回傳沿 direction 方向、從 origin 出發到命中點的距離 t（≥0）；未命中回傳 null。
 * origin 位於 aabb 內部時，回傳 t=0（視為立即命中，供近距離判定用）。
 */
export function rayAabbIntersect(origin: Vec3, direction: Vec3, aabb: Aabb): number | null {
  let tMin = -Infinity;
  let tMax = Infinity;

  for (const axis of ["x", "y", "z"] as const) {
    const o = origin[axis];
    const d = direction[axis];
    const lo = aabb.min[axis];
    const hi = aabb.max[axis];

    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (tMax < 0) return null;
  return tMin >= 0 ? tMin : 0;
}

/**
 * 視線是否無阻擋：由 from 到 to 之間若有任何 collider 擋在中途（交點落在起訖之間，
 * 排除兩端的 epsilon 緩衝避免命中自身 AABB 造成誤判）即視為受阻。
 */
export function hasClearLineOfSight(from: Vec3, to: Vec3, colliders: Aabb[]): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-6) return true;

  const direction: Vec3 = { x: dx / distance, y: dy / distance, z: dz / distance };
  const epsilon = 0.05;

  for (const collider of colliders) {
    const t = rayAabbIntersect(from, direction, collider);
    if (t !== null && t > epsilon && t < distance - epsilon) return false;
  }
  return true;
}
