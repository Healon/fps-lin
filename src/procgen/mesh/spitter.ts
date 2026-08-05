// 射擊體（Spitter）程序化模型：較高瘦的三足機體（約 1.9m），頭部有發光橘色「砲口」，
// 剪影與巡行體（矮壯殭屍人形）明顯不同，一眼可分。由基礎幾何（box）組合生成，所有尺寸
// 皆由 stream('enemy.spitter') 決定，禁止頂點陣列傾印（PLAN §5.2）。配色（PLAN §5.1）：
// 深色機體加 #FF5A26 警示橘（頭部砲口），沿用 crawler.ts 匯出的 WARNING_COLOR 單一色源。
//
// appendColoredBox 不支援任意旋轉（同 crawler.ts 檔頭註解），三足以「純平移不旋轉」的三根
// 細長箱體圍繞中軸排列近似三足站姿，屬低多邊形風格化的合理妥協。

import { stream } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";
import { WARNING_COLOR } from "./crawler.ts";

/** interleaved 頂點格式：position(3) + normal(3) + color(3) = 9 float／頂點（同 crawler.ts）。 */
export const SPITTER_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface SpitterMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  /** 頭部發光砲口局部座標（腳底為原點），供需要精確視覺對齊時換算世界座標使用；
   *  game/spitter.ts 的投射物起點採用獨立的近似常數，不依賴本欄位（邏輯層與外觀層解耦）。 */
  muzzleLocal: Vec3;
}

// 機體深色（與 crawler.ts 同色系但略有差異，避免兩者共用同一份匯出常數造成耦合）。
const BODY_COLOR: Rgb = { r: 0x12 / 255, g: 0x14 / 255, b: 0x18 / 255 };
const LEG_COLOR: Rgb = { r: 0x0e / 255, g: 0x10 / 255, b: 0x13 / 255 };

/**
 * 生成射擊體模型：三足＋細長軀幹＋頭＋發光橘色砲口，共 6 個箱體（3 腿＋軀幹＋頭＋砲口）。
 * 局部座標系以「腳底中心」為原點（y=0），本地前方為 -Z（與 crawler.ts 同慣例）。
 * 全程僅呼叫 stream('enemy.spitter')，純 CPU 決定性：同 seed 兩次呼叫逐位元相同。
 * 站立總高鎖定 1.9±0.1m（見 tests/unit/spitter-mesh.test.ts），命中尺寸為獨立的
 * game/spitter.ts SPITTER_HALF，與本檔視覺尺寸解耦（同 crawler.ts 慣例）。
 */
export function generateSpitterMesh(): SpitterMesh {
  const rng = stream("enemy.spitter");
  const target: BuildTarget = { vertices: [], indices: [] };

  const legHeight = 1.1 + rng() * 0.05;
  const torsoHeight = 0.5 + rng() * 0.04;
  const headHeight = 0.22 + rng() * 0.03;

  // 三足：以中軸為圓心，純平移（不旋轉）圍繞排列，近似三足站姿（appendColoredBox 限制，
  // 見檔頭註解）。半徑與腿粗皆收斂在命中包絡內（不變量測試見下方檔案）。
  const legRadius = 0.12;
  const legHalf: Vec3 = { x: 0.045, y: legHeight / 2, z: 0.045 };
  for (let i = 0; i < 3; i++) {
    const angle = ((i * 120 + 90) * Math.PI) / 180;
    const lx = legRadius * Math.cos(angle);
    const lz = legRadius * Math.sin(angle);
    appendColoredBox(target, { x: lx, y: legHeight / 2, z: lz }, legHalf, LEG_COLOR);
  }

  // 軀幹：細長，坐落於三足頂端（髖部）。
  const hipY = legHeight;
  const torsoHalf: Vec3 = { x: 0.16 + rng() * 0.02, y: torsoHeight / 2, z: 0.16 + rng() * 0.02 };
  const torsoCenter: Vec3 = { x: 0, y: hipY + torsoHeight / 2, z: 0 };
  appendColoredBox(target, torsoCenter, torsoHalf, BODY_COLOR);

  // 頭：置於軀幹頂端，深色機體（發光砲口另由獨立箱體表現，見下方）。
  const headHalf: Vec3 = { x: 0.09, y: headHeight / 2, z: 0.09 };
  const headCenter: Vec3 = { x: 0, y: hipY + torsoHeight + headHeight / 2, z: 0 };
  appendColoredBox(target, headCenter, headHalf, BODY_COLOR);

  // 發光橘色砲口：由頭部前方（-Z）突出的小箱體，全面警示橘，一眼可辨識為射擊體的識別特徵
  // （PLAN §3.4：「頭部有發光橘色砲口」）。
  const muzzleHalf: Vec3 = { x: 0.035, y: 0.035, z: 0.05 };
  const muzzleCenter: Vec3 = { x: 0, y: headCenter.y, z: headCenter.z - headHalf.z - muzzleHalf.z };
  appendColoredBox(target, muzzleCenter, muzzleHalf, WARNING_COLOR);

  return {
    vertices: new Float32Array(target.vertices),
    indices: new Uint32Array(target.indices),
    muzzleLocal: muzzleCenter,
  };
}
