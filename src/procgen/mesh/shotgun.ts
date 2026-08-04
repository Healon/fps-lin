// 散射槍第一人稱 viewmodel：比脈衝手槍寬短的槍身（雙管印象）、短粗槍管、握把，基礎幾何
// 組合生成（禁止頂點陣列傾印，PLAN §5.2）。配色沿用脈衝手槍慣例：深色金屬加能源青科技面板。
// 局部座標系：+X 右、+Y 上、-Z 前方（槍口指向），與 pistol.ts 同慣例。
// 種子固定 stream('weapon.scatter_gun')，純外觀層，禁止 Math.random／Date。

import { stream } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";

export const SHOTGUN_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface ShotgunMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  muzzleLocal: Vec3;
}

const METAL_COLOR: Rgb = { r: 0x1a / 255, g: 0x1d / 255, b: 0x21 / 255 };
const METAL_HIGHLIGHT: Rgb = { r: 0x2c / 255, g: 0x30 / 255, b: 0x36 / 255 };
const TECH_COLOR: Rgb = { r: 0x35 / 255, g: 0xe0 / 255, b: 0xff / 255 };

/**
 * 生成散射槍 viewmodel：較寬短的槍身（含頂面能源青面板）＋短粗槍管（前方突出）＋
 * 前護木（槍管下方，強化「近距離猛槍」的視覺量感）＋握把。同 seed 兩次呼叫逐位元相同。
 * 「比手槍寬短」（PLAN 本次派工規格）：bodyHalf.x／y 較 pistol.ts 大，bodyHalf.z 較小。
 */
export function generateShotgunMesh(): ShotgunMesh {
  const rng = stream("weapon.scatter_gun");
  const target: BuildTarget = { vertices: [], indices: [] };

  const bodyHalf: Vec3 = { x: 0.065 + rng() * 0.006, y: 0.065, z: 0.085 + rng() * 0.008 };
  const bodyCenter: Vec3 = { x: 0, y: 0, z: 0 };
  appendColoredBox(target, bodyCenter, bodyHalf, METAL_COLOR, { py: TECH_COLOR });

  const barrelHalf: Vec3 = { x: 0.026, y: 0.026, z: 0.075 + rng() * 0.008 };
  const barrelCenter: Vec3 = {
    x: 0,
    y: bodyHalf.y * 0.1,
    z: -(bodyHalf.z + barrelHalf.z * 0.85),
  };
  appendColoredBox(target, barrelCenter, barrelHalf, METAL_HIGHLIGHT);

  // 前護木：槍管下方一道窄長箱體，強化雙手持握的視覺量感（散射槍近距猛槍定位）。
  const foreendHalf: Vec3 = { x: 0.032, y: 0.022, z: barrelHalf.z * 0.8 };
  const foreendCenter: Vec3 = { x: 0, y: barrelCenter.y - barrelHalf.y - foreendHalf.y * 0.6, z: barrelCenter.z };
  appendColoredBox(target, foreendCenter, foreendHalf, METAL_COLOR);

  const gripHalf: Vec3 = { x: 0.036, y: 0.08, z: 0.036 };
  const gripCenter: Vec3 = {
    x: 0,
    y: -(bodyHalf.y + gripHalf.y * 0.7),
    z: bodyHalf.z * 0.5,
  };
  appendColoredBox(target, gripCenter, gripHalf, METAL_COLOR);

  const muzzleLocal: Vec3 = {
    x: 0,
    y: barrelCenter.y,
    z: barrelCenter.z - barrelHalf.z,
  };

  return {
    vertices: new Float32Array(target.vertices),
    indices: new Uint32Array(target.indices),
    muzzleLocal,
  };
}
