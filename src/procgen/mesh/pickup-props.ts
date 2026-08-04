// 撿取物視覺標記（非武器類）：彈藥箱與醫療包，基礎幾何組合生成（appendColoredBox，PLAN §5.2）。
// 撿起武器類（脈衝手槍／散射槍）的浮動圖示直接重用各自 viewmodel 網格整體放大，見 main.ts；
// 本檔只負責彈藥與醫療包這兩種非武器造型。純外觀層，禁止 Math.random／Date。

import { stream } from "../../rng/rng.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";

export const PICKUP_PROP_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface PickupPropMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

const AMMO_COLOR: Rgb = { r: 0x35 / 255, g: 0xe0 / 255, b: 0xff / 255 }; // 能源青
const AMMO_HIGHLIGHT: Rgb = { r: 0x18 / 255, g: 0x1d / 255, b: 0x21 / 255 };
const MEDKIT_COLOR: Rgb = { r: 0x1a / 255, g: 0x1d / 255, b: 0x21 / 255 };
const MEDKIT_CROSS: Rgb = { r: 0x3d / 255, g: 0xff / 255, b: 0x8e / 255 }; // 治療綠

/** 彈藥箱：小型能源青箱體，頂面較暗作為金屬蓋板意象。 */
export function generateAmmoBoxMesh(): PickupPropMesh {
  stream("prop.ammo_box");
  const target: BuildTarget = { vertices: [], indices: [] };
  const half = { x: 0.16, y: 0.11, z: 0.11 };
  appendColoredBox(target, { x: 0, y: half.y, z: 0 }, half, AMMO_COLOR, { py: AMMO_HIGHLIGHT });
  return { vertices: new Float32Array(target.vertices), indices: new Uint32Array(target.indices) };
}

/** 醫療包：深色箱體加正面浮凸治療綠十字（兩道細長箱體交疊），一眼可辨識為醫療物資。 */
export function generateMedkitBoxMesh(): PickupPropMesh {
  stream("prop.medkit");
  const target: BuildTarget = { vertices: [], indices: [] };
  const half = { x: 0.15, y: 0.11, z: 0.11 };
  appendColoredBox(target, { x: 0, y: half.y, z: 0 }, half, MEDKIT_COLOR);

  const crossZ = half.z + 0.004;
  appendColoredBox(target, { x: 0, y: half.y, z: crossZ }, { x: half.x * 0.14, y: half.y * 0.65, z: 0.004 }, MEDKIT_CROSS);
  appendColoredBox(target, { x: 0, y: half.y, z: crossZ }, { x: half.x * 0.65, y: half.y * 0.14, z: 0.004 }, MEDKIT_CROSS);

  return { vertices: new Float32Array(target.vertices), indices: new Uint32Array(target.indices) };
}
