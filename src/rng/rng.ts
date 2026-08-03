// 決定性亂數：mulberry32 加 fnv1a 字串 hash 命名空間。
// 全域主種子固定為 96000（PLAN §6.4）。純函式，禁止任何全域可變狀態外洩。

export const MASTER_SEED = 96000;

/** FNV-1a 32 位元字串 hash，回傳 uint32。 */
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // hash *= 16777619（FNV prime），以位元運算展開避免超出 32 位元精度
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type Rng = () => number;

/** mulberry32：輕量、可重現的 32 位元 PRNG，回傳 [0, 1) 區間的浮點數。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 依資產名稱導出獨立亂數串流：assetSeed = fnv1a(assetName) ^ MASTER_SEED。
 * 例如 stream('texture.metal_wall')、stream('level.main')。
 */
export function stream(assetName: string): Rng {
  const seed = (fnv1a(assetName) ^ MASTER_SEED) >>> 0;
  return mulberry32(seed);
}

/** 在 [min, max) 區間取隨機浮點數。 */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** 在 [min, max] 區間取隨機整數（含兩端）。 */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}
