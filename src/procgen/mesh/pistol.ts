// 脈衝手槍第一人稱 viewmodel：槍身、槍管、握把組合生成（基礎幾何 box 組合，禁止頂點陣列
// 傾印，PLAN §5.2）。配色深色金屬加少量能源青 #35E0FF 科技面板（PLAN §5.1：能源青保留給
// 能源科技元件，槍械面板正屬此類）。局部座標系：+X 右、+Y 上、-Z 前方（槍口指向），
// 與相機 forward 一致，供 renderer 以固定 view-space 錨定畫面右下角。
// 種子固定 stream('weapon.pulse_pistol')，全程無 Math.random、無 Date，逐位元決定性；純外觀層。

import { stream } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";

export const PISTOL_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface PistolMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  /** 槍口局部座標（viewmodel 模型座標系），供換算世界座標做為 tracer／槍口特效起點。 */
  muzzleLocal: Vec3;
}

const METAL_COLOR: Rgb = { r: 0x1a / 255, g: 0x1d / 255, b: 0x21 / 255 };
const METAL_HIGHLIGHT: Rgb = { r: 0x2c / 255, g: 0x30 / 255, b: 0x36 / 255 };
const TECH_COLOR: Rgb = { r: 0x35 / 255, g: 0xe0 / 255, b: 0xff / 255 }; // 能源青科技面板

/**
 * 生成脈衝手槍 viewmodel：槍身（含頂面能源青面板）＋槍管（前方突出，較亮金屬）＋
 * 握把（後下方）。同 seed 兩次呼叫逐位元相同。
 */
export function generatePistolMesh(): PistolMesh {
  const rng = stream("weapon.pulse_pistol");
  const target: BuildTarget = { vertices: [], indices: [] };

  const bodyHalf: Vec3 = { x: 0.045 + rng() * 0.006, y: 0.05, z: 0.11 };
  const bodyCenter: Vec3 = { x: 0, y: 0, z: 0 };
  appendColoredBox(target, bodyCenter, bodyHalf, METAL_COLOR, { py: TECH_COLOR });

  const barrelHalf: Vec3 = { x: 0.018, y: 0.018, z: 0.09 + rng() * 0.01 };
  const barrelCenter: Vec3 = {
    x: 0,
    y: bodyHalf.y * 0.15,
    z: -(bodyHalf.z + barrelHalf.z * 0.85),
  };
  appendColoredBox(target, barrelCenter, barrelHalf, METAL_HIGHLIGHT);

  const gripHalf: Vec3 = { x: 0.032, y: 0.075, z: 0.032 };
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
