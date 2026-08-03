// CPU value noise 加 fbm（4 octaves），經 color ramp 產出 512×512 RGBA Uint8Array。
// 種子固定用 stream('texture.metal_wall')，全程無 Math.random、無 Date，逐位元決定性。
// 色票依 PLAN §5.1：底 #16191D、鏽 #4A3222 條紋斑駁、少量 #35E0FF 發光細縫點綴。
//
// 註：PLAN §6.3 的 GPU render-to-texture 材質管線是 M1 之後的事；M0 依 AC 用 CPU noise 加
// ramp 即可，本模組只影響外觀（非玩法決定性資料），CPU 生成是為了 M0 簡化，非架構承諾。

import { type Rng, stream } from "../../rng/rng.ts";

export const TEXTURE_SIZE = 512;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hex(r: number, g: number, b: number): Rgb {
  return { r, g, b };
}

const COLOR_BASE = hex(0x16, 0x19, 0x1d); // 金屬深灰
const COLOR_RUST = hex(0x4a, 0x32, 0x22); // 鏽褐
const COLOR_GLOW = hex(0x2a, 0xb0, 0xe8); // 能源青（牆面用：較 #35E0FF 偏藍壓暗，避免綠感搶色）
const GLOW_INTENSITY = 0.65; // 發光細縫加法混合的強度上限（1 為全強度）

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

/** 建立 0..255 的洗牌排列表（Fisher-Yates，決定性），長度加倍以避免格線索引 wrap 判斷。 */
function buildPermutationTable(rng: Rng): Uint8Array {
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  return perm;
}

/** 格點 hash，回傳 [0, 1) 的值噪聲樣本。 */
function latticeValue(perm: Uint8Array, xi: number, yi: number): number {
  const a = perm[xi & 255];
  const idx = (a + yi) & 511;
  return perm[idx] / 255;
}

/** 2D value noise，回傳約略落在 [0, 1] 的值。 */
function valueNoise2D(perm: Uint8Array, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);

  const v00 = latticeValue(perm, x0, y0);
  const v10 = latticeValue(perm, x1, y0);
  const v01 = latticeValue(perm, x0, y1);
  const v11 = latticeValue(perm, x1, y1);

  const top = lerp(v00, v10, tx);
  const bottom = lerp(v01, v11, tx);
  return lerp(top, bottom, ty);
}

/** fractal brownian motion：多octave 疊加，回傳約略落在 [0, 1] 的值。 */
function fbm(
  perm: Uint8Array,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let amplitudeSum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise2D(perm, x * frequency, y * frequency);
    amplitudeSum += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / amplitudeSum;
}

export interface GeneratedTexture {
  size: number;
  pixels: Uint8Array; // RGBA, size*size*4
}

/**
 * 生成金屬牆面材質：底色加 fbm 噪聲、鏽斑條紋（各向異性頻率製造斑駁條紋）、
 * 少量脊狀噪聲門檻化成能源青發光細縫。
 */
export function generateMetalWallTexture(size = TEXTURE_SIZE): GeneratedTexture {
  const rng = stream("texture.metal_wall");
  const permBase = buildPermutationTable(rng);
  const permRust = buildPermutationTable(rng);
  const permGlow = buildPermutationTable(rng);

  const pixels = new Uint8Array(size * size * 4);
  const scaleBase = 6; // 基礎噪聲的格線密度
  const scaleRustX = 3; // 鏽斑水平方向頻率（較低，形成大片）
  const scaleRustY = 10; // 鏽斑垂直方向頻率（較高，形成條紋）
  const scaleGlow = 18;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // 底材質明暗變化
      const baseNoise = fbm(permBase, u * scaleBase, v * scaleBase, 4, 2, 0.5);
      const shade = 0.75 + baseNoise * 0.5; // 明暗係數，約 0.75 ~ 1.25

      // 鏽斑：各向異性頻率製造直向條紋感，門檻化形成斑駁分布
      const rustNoise = fbm(permRust, u * scaleRustX, v * scaleRustY, 4, 2, 0.5);
      const rustMask = smoothstep((rustNoise - 0.45) / 0.35);

      // 發光細縫：脊狀噪聲（1 - |2n-1|）在高頻下產生窄脊，門檻化取最亮的部分
      const glowRaw = fbm(permGlow, u * scaleGlow, v * scaleGlow, 4, 2.2, 0.5);
      const ridge = 1 - Math.abs(2 * glowRaw - 1);
      const glowMask = smoothstep((ridge - 0.94) / 0.05) * GLOW_INTENSITY;

      let color = lerpColor(COLOR_BASE, COLOR_RUST, rustMask * 0.8);
      color = {
        r: clamp01((color.r / 255) * shade) * 255,
        g: clamp01((color.g / 255) * shade) * 255,
        b: clamp01((color.b / 255) * shade) * 255,
      };
      // 發光細縫以加法混合疊上能源青，維持「少量點綴」的稀疏感
      color = {
        r: clamp01(color.r / 255 + (COLOR_GLOW.r / 255) * glowMask) * 255,
        g: clamp01(color.g / 255 + (COLOR_GLOW.g / 255) * glowMask) * 255,
        b: clamp01(color.b / 255 + (COLOR_GLOW.b / 255) * glowMask) * 255,
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
