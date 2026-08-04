// 地板材質：城堡石板地。基調 #38322B、每塊明度差 ±10%，縫線 #1A1714（深、明顯）。
// 大塊石板約 4×4 格，邊緣抖動（低頻噪聲扭曲格線座標，模擬手工鋪設的不規則接縫）；
// 疊 fbm 斑駁、稀疏細裂紋、低頻濕漬暗斑。種子固定 stream('texture.floor_flagstone')，
// 全程無 Math.random、無 Date，逐位元決定性；純外觀層，不計入 levelHash。
// 取代已淘汰的 texture.floor_planks（PLAN §5.1 v3，2026-08-04 依 Lin 驗收回饋「太木質化」修訂：
// 氛圍改走恐懼／城堡石材，木質感退場）。

import { stream } from "../../rng/rng.ts";
import {
  TEXTURE_SIZE,
  hex,
  clamp01,
  smoothstep,
  lerpColor,
  buildPermutationTable,
  fbm,
  type GeneratedTexture,
  type Rgb,
} from "./noise.ts";

const COLOR_BASE: Rgb = hex(0x38, 0x32, 0x2b); // 石板灰褐基調
const SEAM_COLOR: Rgb = hex(0x1a, 0x17, 0x14); // 縫線，深且明顯

const BLOCKS_X = 4;
const BLOCKS_Z = 4;
const BLOCK_VARIANCE = 0.1; // 每塊明度差 ±10%
const SEAM_HALF_WIDTH = 0.05; // 縫線寬度（格子座標比例）
const JITTER_STRENGTH = 0.055; // 邊緣抖動幅度
const CRACK_THRESHOLD = 0.965; // 細裂紋門檻，越高越稀疏
const CRACK_DARKEN = 0.5;
const DAMP_THRESHOLD = 0.62; // 低頻濕漬暗斑門檻
const DAMP_DARKEN = 0.35;

export function generateFloorFlagstoneTexture(size = TEXTURE_SIZE): GeneratedTexture {
  const rng = stream("texture.floor_flagstone");
  const permJitter = buildPermutationTable(rng);
  const permMottle = buildPermutationTable(rng);
  const permCrack = buildPermutationTable(rng);
  const permDamp = buildPermutationTable(rng);

  // 每塊明度偏移：預留邊界外一圈緩衝，避免抖動後格線索引落在表外。
  const tableW = BLOCKS_X + 2;
  const tableH = BLOCKS_Z + 2;
  const blockOffsets = new Float32Array(tableW * tableH);
  for (let i = 0; i < blockOffsets.length; i++) {
    blockOffsets[i] = (rng() * 2 - 1) * BLOCK_VARIANCE;
  }
  const blockOffset = (ix: number, iz: number): number => {
    const cx = Math.min(tableW - 1, Math.max(0, ix + 1));
    const cz = Math.min(tableH - 1, Math.max(0, iz + 1));
    return blockOffsets[cz * tableW + cx];
  };

  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // 邊緣抖動：低頻噪聲扭曲格線座標，讓石板邊界呈現不規則的手工鋪設感
      const warpU = u + (fbm(permJitter, u * 3, v * 3, 3, 2, 0.5) - 0.5) * JITTER_STRENGTH;
      const warpV = v + (fbm(permJitter, u * 3 + 50, v * 3 + 50, 3, 2, 0.5) - 0.5) * JITTER_STRENGTH;

      const gx = warpU * BLOCKS_X;
      const gz = warpV * BLOCKS_Z;
      const ix = Math.floor(gx);
      const iz = Math.floor(gz);
      const fx = gx - ix;
      const fz = gz - iz;

      const distToSeam = Math.min(fx, 1 - fx, fz, 1 - fz);
      const seamDarken = distToSeam < SEAM_HALF_WIDTH ? 1 - distToSeam / SEAM_HALF_WIDTH : 0;

      // 塊內斑駁
      const mottle = fbm(permMottle, u * 14, v * 14, 4, 2.1, 0.5);
      let shade = 0.86 + mottle * 0.28 + blockOffset(ix, iz);
      shade = clamp01(shade);

      let color: Rgb = {
        r: clamp01((COLOR_BASE.r / 255) * shade) * 255,
        g: clamp01((COLOR_BASE.g / 255) * shade) * 255,
        b: clamp01((COLOR_BASE.b / 255) * shade) * 255,
      };
      color = lerpColor(color, SEAM_COLOR, clamp01(seamDarken));

      // 稀疏細裂紋：高頻脊狀噪聲，極稀疏門檻化
      const crackNoise = fbm(permCrack, u * 60, v * 60, 3, 2.3, 0.5);
      const ridge = 1 - Math.abs(2 * crackNoise - 1);
      const crackMask = smoothstep((ridge - CRACK_THRESHOLD) / (1 - CRACK_THRESHOLD)) * CRACK_DARKEN;
      color = {
        r: color.r * (1 - crackMask),
        g: color.g * (1 - crackMask),
        b: color.b * (1 - crackMask),
      };

      // 低頻濕漬暗斑
      const damp = fbm(permDamp, u * 2.2, v * 2.2, 3, 2, 0.5);
      const dampMask = smoothstep((damp - DAMP_THRESHOLD) / (1 - DAMP_THRESHOLD)) * DAMP_DARKEN;
      color = {
        r: color.r * (1 - dampMask),
        g: color.g * (1 - dampMask),
        b: color.b * (1 - dampMask),
      };

      const idx = (y * size + x) * 4;
      pixels[idx] = Math.round(clamp01(color.r / 255) * 255);
      pixels[idx + 1] = Math.round(clamp01(color.g / 255) * 255);
      pixels[idx + 2] = Math.round(clamp01(color.b / 255) * 255);
      pixels[idx + 3] = 255;
    }
  }

  return { size, pixels };
}
