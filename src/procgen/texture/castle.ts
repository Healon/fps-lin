// 牆面材質：城堡砌石。錯縫砌石（每層橫排，上下層錯半塊），石塊基調 #403830、每塊明度差異，
// 灰縫 #16130F，石塊邊緣壓暗做倒角感，由上往下的垂直水漬暗紋（越靠近地面越濃）。
// 上下各一條火光琥珀 #D98A2B 發光帶（強度約舊版一半，靜態基底；動態閃爍在 renderer 端
// 用 uTime 疊加，見 gfx/renderer.ts）。種子固定 stream('texture.castle_wall')，全程無
// Math.random、無 Date，逐位元決定性；純外觀層，不計入 levelHash。取代已淘汰的
// texture.stone_wall（PLAN §5.1 v3，2026-08-04 依 Lin 驗收回饋「太溫馨，要恐懼」修訂）。

import { stream, fnv1a } from "../../rng/rng.ts";
import {
  TEXTURE_SIZE,
  hex,
  clamp01,
  smoothstep,
  buildPermutationTable,
  fbm,
  type GeneratedTexture,
  type Rgb,
} from "./noise.ts";

const COLOR_BASE: Rgb = hex(0x40, 0x38, 0x30); // 城牆石褐基調
const MORTAR_COLOR: Rgb = hex(0x16, 0x13, 0x0f); // 灰縫
const GLOW_COLOR: Rgb = hex(0xd9, 0x8a, 0x2b); // 火光琥珀
const GLOW_INTENSITY = 0.45; // 舊版 0.9 的約一半（PLAN v3：強度降約一半）
const GLOW_BAND_HALF_WIDTH = 0.045;

const ROWS_MIN = 4;
const ROWS_MAX = 5;
const BLOCKS_PER_ROW_MIN = 5;
const BLOCKS_PER_ROW_MAX = 7;
const BLOCK_VARIANCE = 0.14; // 每塊明度差異
const MORTAR_HALF_WIDTH = 0.05; // 灰縫寬度（格子座標比例）
const BEVEL_WIDTH = 0.14; // 塊緣壓暗（倒角感）寬度，較灰縫更寬更淺
const BEVEL_DARKEN = 0.22;

/** 依 (row, col) 決定性算出一個 [-BLOCK_VARIANCE, BLOCK_VARIANCE] 的明度偏移（非 rng 序列，
 * 因錯縫格線為不規則稀疏索引，改用固定 hash 讓任意 row/col 組合皆可直接查得穩定值）。 */
function blockBrightness(row: number, col: number): number {
  const hash = fnv1a(`castle_block_${row}_${col}`);
  return ((hash % 1000) / 1000) * 2 * BLOCK_VARIANCE - BLOCK_VARIANCE;
}

export function generateCastleWallTexture(size = TEXTURE_SIZE): GeneratedTexture {
  const rng = stream("texture.castle_wall");
  const permMottle = buildPermutationTable(rng);
  const permDamp = buildPermutationTable(rng);
  const permGlow = buildPermutationTable(rng);

  const rowsCount = ROWS_MIN + Math.floor(rng() * (ROWS_MAX - ROWS_MIN + 1));
  const blocksPerRow = BLOCKS_PER_ROW_MIN + Math.floor(rng() * (BLOCKS_PER_ROW_MAX - BLOCKS_PER_ROW_MIN + 1));
  const glowTopCenter = 0.14 + rng() * 0.04;
  const glowBottomCenter = 0.82 + rng() * 0.04;

  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      const rowF = v * rowsCount;
      const row = Math.min(rowsCount - 1, Math.floor(rowF));
      const rowFrac = rowF - row;

      // 錯縫：奇數層橫移半塊寬，形成上下層交錯的「running bond」砌石感
      const stagger = row % 2 === 1 ? 0.5 : 0;
      const colF = u * blocksPerRow + stagger;
      const col = Math.floor(colF);
      const colFrac = colF - col;

      // 塊內斑駁
      const mottle = fbm(permMottle, u * 16, v * 16, 4, 2.1, 0.5);
      let shade = 0.8 + mottle * 0.32 + blockBrightness(row, col);
      shade = clamp01(shade);

      let color: Rgb = {
        r: clamp01((COLOR_BASE.r / 255) * shade) * 255,
        g: clamp01((COLOR_BASE.g / 255) * shade) * 255,
        b: clamp01((COLOR_BASE.b / 255) * shade) * 255,
      };

      // 灰縫（橫向與縱向接縫）與塊緣壓暗（倒角感，較灰縫更寬更淺）
      const distToVSeam = Math.min(colFrac, 1 - colFrac);
      const distToHSeam = Math.min(rowFrac, 1 - rowFrac);
      const seamDist = Math.min(distToVSeam, distToHSeam);
      const mortarDarken = seamDist < MORTAR_HALF_WIDTH ? 1 - seamDist / MORTAR_HALF_WIDTH : 0;

      if (mortarDarken > 0) {
        color = {
          r: color.r + (MORTAR_COLOR.r - color.r) * mortarDarken,
          g: color.g + (MORTAR_COLOR.g - color.g) * mortarDarken,
          b: color.b + (MORTAR_COLOR.b - color.b) * mortarDarken,
        };
      } else if (seamDist < BEVEL_WIDTH) {
        const bevelDarken = (1 - seamDist / BEVEL_WIDTH) * BEVEL_DARKEN;
        color = {
          r: color.r * (1 - bevelDarken),
          g: color.g * (1 - bevelDarken),
          b: color.b * (1 - bevelDarken),
        };
      }

      // 垂直水漬暗紋：u 方向高頻（多條分散直紋位置）、v 方向極低頻（沿牆高拉長成直條）；
      // 牆面貼圖 v=0 對應底部，(1-v) 加權讓水漬越靠近地面越濃，模擬向下累積的濕氣。
      const dampNoise = fbm(permDamp, u * 26, v * 1.5, 3, 2, 0.5);
      const dampMask = smoothstep((dampNoise - 0.6) / 0.4) * (1 - v) * 0.4;
      color = {
        r: color.r * (1 - dampMask),
        g: color.g * (1 - dampMask),
        b: color.b * (1 - dampMask),
      };

      // 火光琥珀發光帶（上下各一，強度約舊版一半；動態閃爍疊加在 shader 端，本模組只烘靜態基底）
      const glowNoise = fbm(permGlow, u * 22, v * 22, 3, 2, 0.5);
      const bandFlicker = 0.7 + glowNoise * 0.3;
      const topBand = smoothstep(1 - Math.abs(v - glowTopCenter) / GLOW_BAND_HALF_WIDTH) * bandFlicker;
      const bottomBand = smoothstep(1 - Math.abs(v - glowBottomCenter) / GLOW_BAND_HALF_WIDTH) * bandFlicker;
      const glow = clamp01(topBand + bottomBand) * GLOW_INTENSITY;

      color = {
        r: clamp01(color.r / 255 + (GLOW_COLOR.r / 255) * glow) * 255,
        g: clamp01(color.g / 255 + (GLOW_COLOR.g / 255) * glow) * 255,
        b: clamp01(color.b / 255 + (GLOW_COLOR.b / 255) * glow) * 255,
      };

      const idx = (y * size + x) * 4;
      pixels[idx] = Math.round(color.r);
      pixels[idx + 1] = Math.round(color.g);
      pixels[idx + 2] = Math.round(color.b);
      pixels[idx + 3] = 255;
    }
  }

  return { size, pixels };
}
