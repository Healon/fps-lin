// 電漿步槍第一人稱 viewmodel：比散射槍更長的槍身（中距壓制武器的量感）、細長槍管、握把，
// 另加一道貫穿槍身頂面的能源青發光條（本次派工規格：「比散射槍長，帶能源青發光條」），
// 與脈衝手槍／散射槍的科技面板做出區隔（面板是一塊色塊，發光條是狹長貫穿全槍身的帶狀）。
// 基礎幾何組合生成（禁止頂點陣列傾印，PLAN §5.2）。局部座標系：+X 右、+Y 上、-Z 前方
// （槍口指向），與 pistol.ts／shotgun.ts 同慣例。種子固定 stream('weapon.plasma_rifle')，
// 純外觀層，禁止 Math.random／Date。

import { stream } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";

export const PLASMA_RIFLE_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface PlasmaRifleMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  muzzleLocal: Vec3;
}

const METAL_COLOR: Rgb = { r: 0x1a / 255, g: 0x1d / 255, b: 0x21 / 255 };
const METAL_HIGHLIGHT: Rgb = { r: 0x2c / 255, g: 0x30 / 255, b: 0x36 / 255 };
const GLOW_COLOR: Rgb = { r: 0x35 / 255, g: 0xe0 / 255, b: 0xff / 255 }; // 能源青發光條

/**
 * 生成電漿步槍 viewmodel：修長槍身（頂面貫穿能源青發光條）＋細長槍管（前方突出，較亮金屬）＋
 * 握把（後下方）＋護木（槍管下方，中距武器的持握量感）。同 seed 兩次呼叫逐位元相同。
 * 「比散射槍長」（本次派工規格）：bodyHalf.z／barrelHalf.z 較 shotgun.ts 大。
 */
export function generatePlasmaRifleMesh(): PlasmaRifleMesh {
  const rng = stream("weapon.plasma_rifle");
  const target: BuildTarget = { vertices: [], indices: [] };

  const bodyHalf: Vec3 = { x: 0.04 + rng() * 0.005, y: 0.045, z: 0.16 + rng() * 0.012 };
  const bodyCenter: Vec3 = { x: 0, y: 0, z: 0 };
  appendColoredBox(target, bodyCenter, bodyHalf, METAL_COLOR);

  // 發光條：貫穿槍身頂面的狹長薄板（獨立箱體，而非 appendColoredBox 的單面著色，確保
  // 視覺上明顯「凸起貫穿」而非僅一塊面色，與脈衝手槍／散射槍的頂面色塊面板做出區隔）。
  const glowHalf: Vec3 = { x: bodyHalf.x * 0.35, y: 0.006, z: bodyHalf.z * 0.92 };
  const glowCenter: Vec3 = { x: 0, y: bodyHalf.y + glowHalf.y, z: 0 };
  appendColoredBox(target, glowCenter, glowHalf, GLOW_COLOR);

  const barrelHalf: Vec3 = { x: 0.016, y: 0.016, z: 0.14 + rng() * 0.012 };
  const barrelCenter: Vec3 = {
    x: 0,
    y: bodyHalf.y * 0.1,
    z: -(bodyHalf.z + barrelHalf.z * 0.85),
  };
  appendColoredBox(target, barrelCenter, barrelHalf, METAL_HIGHLIGHT);

  // 護木：槍管下方一道窄長箱體（中距武器的雙手持握量感，同 shotgun.ts 前護木精神）。
  const foreendHalf: Vec3 = { x: 0.026, y: 0.018, z: barrelHalf.z * 0.75 };
  const foreendCenter: Vec3 = { x: 0, y: barrelCenter.y - barrelHalf.y - foreendHalf.y * 0.6, z: barrelCenter.z * 0.9 };
  appendColoredBox(target, foreendCenter, foreendHalf, METAL_COLOR);

  const gripHalf: Vec3 = { x: 0.03, y: 0.075, z: 0.03 };
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
