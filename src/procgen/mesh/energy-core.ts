// 能源核心視覺結構（M3 第三階段，區域 F）：程序化生成的高聳柱體加多道能源青發光環帶，靜態
// 關卡道具（同 procgen/mesh/console.ts 慣例，經 renderer.uploadPropGeometry 上傳、main.ts 以
// PickupDef 以外的固定 prop 實例渲染）。局部座標系：中心 (0,0,0) 即基座底部貼齊 y=0（地面），
// 與 LevelData.energyCorePos（世界座標）對齊。純外觀層，禁止 Math.random／Date。

import { stream } from "../../rng/rng.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";

export const ENERGY_CORE_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface EnergyCoreMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

const METAL_COLOR: Rgb = { r: 0x14 / 255, g: 0x16 / 255, b: 0x1a / 255 };
const GLOW_COLOR: Rgb = { r: 0x35 / 255, g: 0xe0 / 255, b: 0xff / 255 };

/**
 * 生成能源核心結構：高聳柱體（約 9m，貫穿區域 F 挑高）加三道等距能源青發光環帶（薄片，
 * 略外擴柱體）。種子固定 stream('prop.energy_core')，純外觀層，禁止 Math.random／Date。
 */
export function generateEnergyCoreMesh(): EnergyCoreMesh {
  stream("prop.energy_core");
  const target: BuildTarget = { vertices: [], indices: [] };

  const coreHalf = { x: 0.85, y: 4.4, z: 0.85 }; // 高度 8.8m，貼近區域 F 挑高 9m 但留頂部淨空
  appendColoredBox(target, { x: 0, y: coreHalf.y, z: 0 }, coreHalf, METAL_COLOR);

  const ringHeights = [2.2, 4.4, 6.6];
  for (const ringY of ringHeights) {
    const ringHalf = { x: coreHalf.x + 0.22, y: 0.16, z: coreHalf.x + 0.22 };
    appendColoredBox(target, { x: 0, y: ringY, z: 0 }, ringHalf, GLOW_COLOR);
  }

  return { vertices: new Float32Array(target.vertices), indices: new Uint32Array(target.indices) };
}
