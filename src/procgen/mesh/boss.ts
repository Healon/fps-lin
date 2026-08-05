// 首領「核心守護者」程序化模型：厚重機械核心量感，由基礎幾何（box）組合生成，所有尺寸皆由
// stream('enemy.boss') 決定，禁止頂點陣列傾印（PLAN §5.2）。剪影刻意獨一無二：明顯大於一切
// 敵人（約 3m 高，crawler／spitter／warden 皆不足 2m），多層堆疊箱體（往上收窄）加能源青
// 發光環帶（呼應 procgen/mesh/energy-core.ts 的環帶語彙，強化「戰鬥中核心與首領一體」的
// 視覺關聯，見 PLAN 本次派工規格），前方一枚警示橘弱點面（核心反應爐意象）。
//
// 首領全身可打、無方向性減傷（見 game/boss.ts applyDamage），故本檔不像 warden.ts 需區分
// 正面／背面配色，弱點面純為視覺教學（暗示「這是核心」）而非命中判定差異。

import { stream } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";
import { WARNING_COLOR } from "./crawler.ts";

export const BOSS_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface BossMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

const BODY_COLOR: Rgb = { r: 0x0b / 255, g: 0x0c / 255, b: 0x0f / 255 }; // 比守衛體更沉，龐然機體
const ARMOR_COLOR: Rgb = { r: 0x1f / 255, g: 0x23 / 255, b: 0x29 / 255 };
const GLOW_COLOR: Rgb = { r: 0x35 / 255, g: 0xe0 / 255, b: 0xff / 255 }; // 能源青環帶

/**
 * 生成核心守護者模型：厚重基座＋兩層收窄堆疊箱體（各配一圈能源青環帶）＋頂部警示橘弱點面
 * （核心反應爐意象）。局部座標系以「腳底中心」為原點（y=0），本地前方為 -Z（同其餘敵人慣例）。
 * 全程僅呼叫 stream('enemy.boss')，純 CPU 決定性：同 seed 兩次呼叫逐位元相同。
 * 站立總高鎖定約 3.0±0.3m（見 tests/unit/boss-mesh.test.ts），命中尺寸為獨立的
 * game/boss.ts BOSS_HALF，與本檔視覺尺寸解耦（同 crawler.ts／spitter.ts／warden.ts 慣例）。
 * 所有頂點的水平半徑（hypot(x,z)）皆收斂在 BOSS_HALF 的命中包絡內（含 AIM_ASSIST_MARGIN
 * 安全餘量），見 tests/unit/boss-mesh.test.ts 不變量測試。
 */
export function generateBossMesh(): BossMesh {
  const rng = stream("enemy.boss");
  const target: BuildTarget = { vertices: [], indices: [] };

  // 基座：厚重方形基座，全模型最寬處。
  const baseHalf: Vec3 = { x: 0.95 + rng() * 0.03, y: 0.5, z: 0.85 + rng() * 0.03 };
  appendColoredBox(target, { x: 0, y: baseHalf.y, z: 0 }, baseHalf, BODY_COLOR);

  // 基座頂緣一圈能源青環帶（薄片，略外擴）。
  const baseRingHalf: Vec3 = { x: baseHalf.x + 0.05, y: 0.05, z: baseHalf.z + 0.05 };
  appendColoredBox(target, { x: 0, y: baseHalf.y * 2 - baseRingHalf.y, z: 0 }, baseRingHalf, GLOW_COLOR);

  // 第一層：略收窄，裝甲色（比機體亮一階，強化層次感）。
  const layer1Half: Vec3 = { x: baseHalf.x * 0.85, y: 0.6, z: baseHalf.z * 0.85 };
  const layer1CenterY = baseHalf.y * 2 + layer1Half.y;
  appendColoredBox(target, { x: 0, y: layer1CenterY, z: 0 }, layer1Half, ARMOR_COLOR);
  const layer1RingHalf: Vec3 = { x: layer1Half.x + 0.05, y: 0.05, z: layer1Half.z + 0.05 };
  appendColoredBox(target, { x: 0, y: layer1CenterY + layer1Half.y - layer1RingHalf.y, z: 0 }, layer1RingHalf, GLOW_COLOR);

  // 第二層（頂層）：再收窄，機體深色。
  const layer2Half: Vec3 = { x: layer1Half.x * 0.78, y: 0.4, z: layer1Half.z * 0.78 };
  const layer2CenterY = layer1CenterY + layer1Half.y + layer2Half.y;
  appendColoredBox(target, { x: 0, y: layer2CenterY, z: 0 }, layer2Half, BODY_COLOR);

  // 弱點面（核心反應爐意象）：頂層前方（-Z）突出的小型警示橘箱體，全模型唯一的自發光弱點。
  const eyeHalf: Vec3 = { x: 0.35, y: 0.22, z: 0.12 };
  const eyeCenter: Vec3 = { x: 0, y: layer2CenterY, z: -(layer2Half.z + eyeHalf.z * 0.6) };
  appendColoredBox(target, eyeCenter, eyeHalf, WARNING_COLOR);

  return {
    vertices: new Float32Array(target.vertices),
    indices: new Uint32Array(target.indices),
  };
}
