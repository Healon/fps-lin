// 守衛體（Warden）程序化模型：厚重寬體機甲（約 2.0m 高），由基礎幾何（box）組合生成，
// 所有尺寸皆由 stream('enemy.warden') 決定，禁止頂點陣列傾印（PLAN §5.2）。剪影刻意「寬」
// （胸甲橫向外擴），與巡行體（矮壯，雙臂前伸）、射擊體（瘦高三足）一眼可分（本次派工規格）。
//
// 弱點視覺教學（本次派工規格）：警示橘配在背部（appendColoredBox 的 pz 面，本地後方），
// 正面（appendColoredBox 的 nz 面，本地前方 -Z）為大塊深色裝甲板，玩家必須繞到背後才看得到
// 橘色——與 game/warden.ts 的方向性減傷機制（正面減傷 50%）視覺對應：能看到橘色的角度，
// 就是能造成全額傷害的角度。appendColoredBox 不支援任意旋轉（同 crawler.ts 檔頭註解），
// 前傾／量感以「逐部位中心偏移」近似（低多邊形風格化的合理妥協，同 crawler.ts 駝背前傾作法）。

import { stream } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";
import { WARNING_COLOR } from "./crawler.ts";

/** interleaved 頂點格式：position(3) + normal(3) + color(3) = 9 float／頂點（同 crawler.ts）。 */
export const WARDEN_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface WardenMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

// 機體深色（比 crawler／spitter 更沉、更冷，強化「重裝甲」量感）。
const BODY_COLOR: Rgb = { r: 0x0d / 255, g: 0x0f / 255, b: 0x12 / 255 };
const ARMOR_COLOR: Rgb = { r: 0x1e / 255, g: 0x21 / 255, b: 0x26 / 255 }; // 正面裝甲板，深色無警示

/**
 * 生成守衛體模型：粗壯雙腿＋寬厚軀幹（正面大塊裝甲板、背面警示橘）＋頭（無獨立警示面，
 * 警示色集中於背部才看得到，符合「繞背才看得到橘色」的視覺教學）＋寬肩護甲（強化橫向剪影）。
 * 局部座標系以「腳底中心」為原點（y=0），本地前方為 -Z（與 crawler.ts／spitter.ts 同慣例）。
 * 全程僅呼叫 stream('enemy.warden')，純 CPU 決定性：同 seed 兩次呼叫逐位元相同。
 * 站立總高鎖定 2.0±0.15m（見 tests/unit/warden-mesh.test.ts），命中尺寸為獨立的
 * game/warden.ts WARDEN_HALF，與本檔視覺尺寸解耦（同 crawler.ts／spitter.ts 慣例）。
 */
export function generateWardenMesh(): WardenMesh {
  const rng = stream("enemy.warden");
  const target: BuildTarget = { vertices: [], indices: [] };

  const legHeight = 0.85 + rng() * 0.05;
  const torsoHeight = 0.78 + rng() * 0.05;
  const headHeight = 0.3 + rng() * 0.03;

  const legHalf: Vec3 = { x: 0.16 + rng() * 0.02, y: legHeight / 2, z: 0.18 + rng() * 0.02 };
  const legSpacingX = 0.24;
  const legCenterY = legHeight / 2;
  appendColoredBox(target, { x: -legSpacingX, y: legCenterY, z: 0 }, legHalf, BODY_COLOR);
  appendColoredBox(target, { x: legSpacingX, y: legCenterY, z: 0 }, legHalf, BODY_COLOR);

  // 軀幹：寬厚（x 半寬明顯大於 crawler／spitter），正面（-Z，nz）大塊深色裝甲板，
  // 背面（+Z，pz）警示橘（弱點視覺教學：繞背才看得到）。尺寸收斂在命中包絡內
  // （不變量測試見 tests/unit/warden-mesh.test.ts，與 crawler-mesh.test.ts 同精神）。
  const hipY = legHeight;
  const torsoHalf: Vec3 = { x: 0.48 + rng() * 0.02, y: torsoHeight / 2, z: 0.4 + rng() * 0.02 };
  const torsoCenter: Vec3 = { x: 0, y: hipY + torsoHeight / 2, z: 0 };
  // 2026-08-05 render-first 驗收發現：appendColoredBox／appendBox（procgen/mesh/box.ts）
  // 產生的 nz／pz 四邊形，其實際三角形繞序（winding）與宣告的 normal 欄位方向相反——
  // 以精確站在「facingYaw 所指方向」（forwardFromYawPitch(yaw,0)）逐幀重算相機位置實測
  // 確認：GL 剔除（cullFace BACK）後，站在該方向實際看到的是 pz 面，不是 normal=[0,0,-1]
  // 宣告的 nz 面（此為 box.ts 既有的一貫特性，非本檔獨有；crawler.ts 亦受此影響但不在本次
  // 派工範圍內，僅記錄於此供日後追查）。故此處刻意「反著填」：nz 給 WARNING_COLOR（實際從
  // 背後可見）、pz 給 ARMOR_COLOR（實際從面向方向可見），才能達成設計意圖「正面看到深色
  // 裝甲板、繞到背後看到警示橘」。驗證見 tests/unit/warden-mesh.test.ts 對應註解。
  appendColoredBox(target, torsoCenter, torsoHalf, BODY_COLOR, { nz: WARNING_COLOR, pz: ARMOR_COLOR });

  // 寬肩護甲 ×2：由軀幹兩側略微外擴的扁平箱體，加強「寬」剪影但收斂在包絡內
  // （本次派工規格：一眼可分的寬體，主要寬度已由軀幹本身撐開，肩甲只是加強讀感）。
  const shoulderHalf: Vec3 = { x: 0.08, y: 0.14, z: 0.28 };
  const shoulderY = hipY + torsoHeight * 0.88;
  const shoulderX = torsoHalf.x + shoulderHalf.x * 0.5;
  appendColoredBox(target, { x: -shoulderX, y: shoulderY, z: 0 }, shoulderHalf, ARMOR_COLOR);
  appendColoredBox(target, { x: shoulderX, y: shoulderY, z: 0 }, shoulderHalf, ARMOR_COLOR);

  // 頭：置於軀幹頂端，深色機體（無獨立警示面，警示色集中於背部裝甲，符合弱點視覺教學）。
  const headHalf: Vec3 = { x: 0.18, y: headHeight / 2, z: 0.18 };
  const headCenter: Vec3 = { x: 0, y: hipY + torsoHeight + headHeight / 2, z: 0 };
  appendColoredBox(target, headCenter, headHalf, BODY_COLOR);

  return {
    vertices: new Float32Array(target.vertices),
    indices: new Uint32Array(target.indices),
  };
}
