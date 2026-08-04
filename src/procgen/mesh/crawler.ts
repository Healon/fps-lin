// 巡行體程序化模型：殭屍人形（頭、軀幹、雙腿、雙臂前伸），由基礎幾何（box）組合生成，
// 所有尺寸與駝背前傾角由 stream('enemy.crawler') 決定。禁止頂點陣列傾印，所有幾何皆由
// 參數化程式產生（PLAN §5.2）。配色（PLAN §5.1）：深色機體加 #FF5A26 敵對橘警示點（眼睛與
// 胸口），以頂點色實作（無外部材質檔）。
//
// 2026-08-04 v4（Lin 實玩 M1 draft 回饋，設計修正輪）：原為多足昆蟲式機體，改為約 1.7m 高的
// 殭屍人形，便於玩家瞄準且更符合「巡行體」的恐懼美術方向。appendColoredBox 只接受 AABB 中心
// 與半長（無法整體旋轉單一箱體），駝背前傾以「各部位中心依高度差做前移量」近似傾斜姿態
// （低多邊形風格化的合理妥協，非真實骨架旋轉）。

import { stream } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";

/** interleaved 頂點格式：position(3) + normal(3) + color(3) = 9 float／頂點（無 uv，純頂點色）。 */
export const CRAWLER_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface CrawlerMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

// 機體深色（比 PLAN 金屬深灰 #16191D 更暗，強化「敵對機械／腐化人形」的壓迫感）
const BODY_COLOR: Rgb = { r: 0x10 / 255, g: 0x12 / 255, b: 0x15 / 255 };
// 警示橘（PLAN §5.1 #FF5A26）：對外匯出供 renderer 端做「自發光」emissive 判定使用
// （見 gfx/renderer.ts 的 uWarningColor），確保新光照下敵人的警示色仍清楚可辨。
export const WARNING_COLOR: Rgb = { r: 0xff / 255, g: 0x5a / 255, b: 0x26 / 255 };

/**
 * 生成巡行體模型：雙腿＋軀幹＋頭＋雙臂前伸，共 6 個箱體。局部座標系以「腳底中心」為原點
 * （y=0），與 Crawler.position（腳底）對齊；本地前方為 -Z（與 core/math.ts 的
 * forwardFromYawPitch／rotationYMat4 同慣例，yaw=0 朝 -Z），故頭部與手臂皆朝 -Z 延伸。
 * 全程僅呼叫 stream('enemy.crawler')，純 CPU 決定性：同 seed 兩次呼叫逐位元相同。
 * 站立總高鎖定 1.7±0.1m（見 tests/unit/crawler-mesh.test.ts），供瞄準辨識用的
 * game/enemy.ts CRAWLER_HALF 為獨立的碰撞尺寸，與本檔視覺尺寸解耦。
 */
export function generateCrawlerMesh(): CrawlerMesh {
  const rng = stream("enemy.crawler");
  const target: BuildTarget = { vertices: [], indices: [] };

  // 高度分段（腿／軀幹／頭），總和落在 1.66～1.77m，符合 1.7±0.1m 的站姿高度鎖定。
  const legHeight = 0.8 + rng() * 0.04;
  const torsoHeight = 0.54 + rng() * 0.04;
  const headHeight = 0.32 + rng() * 0.03;

  const torsoHalf: Vec3 = { x: 0.22 + rng() * 0.05, y: torsoHeight / 2, z: 0.15 + rng() * 0.04 };
  const legHalf: Vec3 = { x: torsoHalf.x * 0.32, y: legHeight / 2, z: torsoHalf.z * 0.65 };
  const headHalf: Vec3 = { x: torsoHalf.x * 0.55, y: headHeight / 2, z: torsoHalf.z * 0.7 };

  // 駝背前傾 10～15 度：以髖部（腿頂，y = legHeight）為樞紐，軀幹／頭／手臂中心依各自高度
  // 與髖部的落差乘上 tan(傾角) 做前移量（沿 -Z，即本地前方），近似整體前傾姿態。
  const leanRad = ((10 + rng() * 5) * Math.PI) / 180;
  const hipY = legHeight;
  const leanOffsetZ = (centerY: number): number => -(centerY - hipY) * Math.tan(leanRad);

  // 雙腿：站立於腳底（y=0），不受前傾影響（雙腳維持貼地）。
  const legSpacingX = torsoHalf.x * 0.5;
  const legCenterY = legHeight / 2;
  appendColoredBox(target, { x: -legSpacingX, y: legCenterY, z: 0 }, legHalf, BODY_COLOR);
  appendColoredBox(target, { x: legSpacingX, y: legCenterY, z: 0 }, legHalf, BODY_COLOR);

  // 軀幹：胸口面（-Z，面向移動方向）著警示橘，供暗場景一眼可辨（PLAN §3.4 v4）。
  const torsoCenterY = hipY + torsoHeight / 2;
  const torsoCenter: Vec3 = { x: 0, y: torsoCenterY, z: leanOffsetZ(torsoCenterY) };
  appendColoredBox(target, torsoCenter, torsoHalf, BODY_COLOR, { nz: WARNING_COLOR });

  // 頭：置於軀幹頂端並略前於軀幹前緣（前移量收斂在命中包絡內），前臉（眼睛所在面）著警示橘。
  const headCenterY = hipY + torsoHeight + headHeight / 2;
  const headCenter: Vec3 = {
    x: 0,
    y: headCenterY,
    z: leanOffsetZ(headCenterY) - torsoHalf.z - headHalf.z * 0.4,
  };
  appendColoredBox(target, headCenter, headHalf, BODY_COLOR, { nz: WARNING_COLOR });

  // 雙臂前伸（殭屍伸手感）：由肩膀朝 -Z 方向（面向前方）伸出，手臂本體維持機體深色。
  // 尺寸約束：命中 AABB 不隨 yaw 旋轉，所以「任何朝向都打得中」要求每個頂點的水平半徑
  // ≤ min(CRAWLER_HALF.x, CRAWLER_HALF.z) + AIM_ASSIST_MARGIN。手臂是最外緣的部位，
  // 前伸長度與側移都收斂在該包絡內（不變量測試見 tests/unit/crawler-mesh.test.ts）。
  const armHalf: Vec3 = {
    x: 0.055 + rng() * 0.015,
    y: 0.05 + rng() * 0.015,
    z: 0.085 + rng() * 0.02,
  };
  const armShoulderY = hipY + torsoHeight * 0.82;
  const armSideX = torsoHalf.x * 0.8;
  const armFrontZ = leanOffsetZ(armShoulderY) - torsoHalf.z * 0.6 - armHalf.z;
  appendColoredBox(target, { x: -armSideX, y: armShoulderY, z: armFrontZ }, armHalf, BODY_COLOR);
  appendColoredBox(target, { x: armSideX, y: armShoulderY, z: armFrontZ }, armHalf, BODY_COLOR);

  return {
    vertices: new Float32Array(target.vertices),
    indices: new Uint32Array(target.indices),
  };
}
