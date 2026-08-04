// 材質生成共用工具：CPU value noise 加 fbm、色彩混合輔助函式。無 Math.random、無 Date；
// 呼叫端各自以 stream() 建立獨立 rng 命名空間，本模組只提供純函式工具，不含任何隨機性來源。
// 具體材質（地板／牆面）見 procgen/texture/floor.ts 與 procgen/texture/wall.ts。

import { type Rng } from "../../rng/rng.ts";

export const TEXTURE_SIZE = 512;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface GeneratedTexture {
  size: number;
  pixels: Uint8Array; // RGBA, size*size*4
}

export function hex(r: number, g: number, b: number): Rgb {
  return { r, g, b };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpColor(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

/** 建立 0..255 的洗牌排列表（Fisher-Yates，決定性），長度加倍以避免格線索引 wrap 判斷。 */
export function buildPermutationTable(rng: Rng): Uint8Array {
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
export function valueNoise2D(perm: Uint8Array, x: number, y: number): number {
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

/**
 * fractal brownian motion：多 octave 疊加，回傳約略落在 [0, 1] 的值。
 * freqX／freqY 各向異性頻率係數（預設皆 1，等向），供拉長紋理方向使用（如木紋沿板長方向）。
 */
export function fbm(
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
