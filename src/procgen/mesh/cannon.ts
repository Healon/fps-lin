// 能量砲第一人稱 viewmodel：粗壯厚重的槍身（比電漿步槍寬厚，充能式重武器的量感）、短粗槍管、
// 護木、握把，基礎幾何組合生成（禁止頂點陣列傾印，PLAN §5.2）。充能時能源青發光強度隨充能
// 比例增強（本次派工規格：「可用 uniform 或頂點色插值」，本檔採離散三級頂點色分層實作——
// 與既有 procgen/mesh/console.ts 的 idle／active 雙版本 prop 換色慣例一致，main.ts 依
// EnergyCannon.chargeProgress 換算的 tier 呼叫 renderer 對應的已上傳版本，見 gfx/renderer.ts
// renderViewmodel 的 cannonGlowTier 參數；不新增共用 enemyProgram 的 shader uniform，
// 避免牽動其餘武器與敵人共用的渲染管線）。局部座標系：+X 右、+Y 上、-Z 前方（槍口指向），
// 與 pistol.ts／shotgun.ts／plasma-rifle.ts 同慣例。種子固定 stream('weapon.cannon')，
// 純外觀層，禁止 Math.random／Date。

import { stream } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";

export const CANNON_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface CannonMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  muzzleLocal: Vec3;
}

const METAL_COLOR: Rgb = { r: 0x1c / 255, g: 0x1f / 255, b: 0x24 / 255 };
const METAL_HIGHLIGHT: Rgb = { r: 0x30 / 255, g: 0x34 / 255, b: 0x3a / 255 };

/** 三級充能發光色：0＝待機（暗青，近似 console.ts 的 idle 面板色）、1＝充能中（能源青標準色）、
 *  2＝充滿待放（提亮至近白，強烈視覺回饋）。 */
const GLOW_COLOR_BY_TIER: readonly Rgb[] = [
  { r: 0x1c / 255, g: 0x5a / 255, b: 0x66 / 255 },
  { r: 0x35 / 255, g: 0xe0 / 255, b: 0xff / 255 },
  { r: 0xc8 / 255, g: 0xfb / 255, b: 0xff / 255 },
];

/**
 * 生成能量砲 viewmodel：粗壯厚重槍身（頂面貫穿發光條，顏色依 glowTier 決定）＋短粗槍管
 * （前方突出）＋護木＋握把。同 seed 同 glowTier 兩次呼叫逐位元相同。glowTier 超出 0..2
 * 範圍會被夾限。「粗壯厚重」（本次派工規格）：bodyHalf 明顯大於 plasma-rifle.ts。
 */
export function generateCannonMesh(glowTier: 0 | 1 | 2 = 0): CannonMesh {
  const rng = stream("weapon.cannon");
  const target: BuildTarget = { vertices: [], indices: [] };
  const tier = glowTier < 0 ? 0 : glowTier > 2 ? 2 : glowTier;
  const glowColor = GLOW_COLOR_BY_TIER[tier];

  const bodyHalf: Vec3 = { x: 0.075 + rng() * 0.006, y: 0.075, z: 0.2 + rng() * 0.012 };
  const bodyCenter: Vec3 = { x: 0, y: 0, z: 0 };
  appendColoredBox(target, bodyCenter, bodyHalf, METAL_COLOR);

  // 發光條：貫穿槍身頂面的寬厚薄板（比 plasma-rifle.ts 更寬，呼應「粗壯厚重」）。
  const glowHalf: Vec3 = { x: bodyHalf.x * 0.6, y: 0.01, z: bodyHalf.z * 0.9 };
  const glowCenter: Vec3 = { x: 0, y: bodyHalf.y + glowHalf.y, z: 0 };
  appendColoredBox(target, glowCenter, glowHalf, glowColor);

  const barrelHalf: Vec3 = { x: 0.05, y: 0.05, z: 0.13 + rng() * 0.012 };
  const barrelCenter: Vec3 = {
    x: 0,
    y: bodyHalf.y * 0.05,
    z: -(bodyHalf.z + barrelHalf.z * 0.85),
  };
  appendColoredBox(target, barrelCenter, barrelHalf, METAL_HIGHLIGHT);

  // 槍口環：短小突出箱體，貼在槍管前緣，發光色隨 tier 變化（強化「即將發射」的視覺回饋）。
  const muzzleRingHalf: Vec3 = { x: barrelHalf.x * 1.08, y: barrelHalf.y * 1.08, z: 0.02 };
  const muzzleRingCenter: Vec3 = { x: barrelCenter.x, y: barrelCenter.y, z: barrelCenter.z - barrelHalf.z - muzzleRingHalf.z };
  appendColoredBox(target, muzzleRingCenter, muzzleRingHalf, glowColor);

  // 護木：槍管下方厚實箱體（雙手持握的重武器量感）。
  const foreendHalf: Vec3 = { x: 0.045, y: 0.03, z: barrelHalf.z * 0.85 };
  const foreendCenter: Vec3 = { x: 0, y: barrelCenter.y - barrelHalf.y - foreendHalf.y * 0.6, z: barrelCenter.z };
  appendColoredBox(target, foreendCenter, foreendHalf, METAL_COLOR);

  const gripHalf: Vec3 = { x: 0.04, y: 0.09, z: 0.04 };
  const gripCenter: Vec3 = {
    x: 0,
    y: -(bodyHalf.y + gripHalf.y * 0.7),
    z: bodyHalf.z * 0.55,
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
