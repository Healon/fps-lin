// 滑動門板 viewmodel-style 網格：金屬深色門板加能源青科技面板條紋（呼應武器與敵人的頂點色
// 慣例）。全關卡三扇門（A／B／終點）共用同一份幾何，尺寸已於 procgen/level/level.ts 統一為
// 半寬 1.5m、半高 1.6m、半厚 0.125m，渲染時只需依各門世界座標與朝向（yaw）搬移。局部座標系：
// 中心 (0, halfHeight, 0)，即底部貼齊 y=0（地面），與 DoorDef.pos（門底中心）對齊。
// 種子固定 stream('prop.door')，純外觀層，禁止 Math.random／Date。

import { stream } from "../../rng/rng.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";
import { DOOR_PANEL_HALF_HEIGHT, DOOR_PANEL_HALF_THICKNESS, DOOR_PANEL_HALF_WIDTH } from "../level/level.ts";

export const DOOR_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface DoorMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

const METAL_COLOR: Rgb = { r: 0x1a / 255, g: 0x1d / 255, b: 0x21 / 255 };
const TECH_COLOR: Rgb = { r: 0x35 / 255, g: 0xe0 / 255, b: 0xff / 255 };

/**
 * 生成共用門板網格：主體深色金屬，正／反面各加一道極窄的能源青「中央滑縫」（雙開門意象）與
 * 一道細長「狀態指示條」標示機關身分。尺寸與 DoorDef.collider 完全對齊（不加隨機抖動），
 * 避免視覺與碰撞範圍不一致；仍保留 stream('prop.door') 呼叫供未來擴充細節時延續決定性慣例。
 *
 * 設計註記：初版曾用 faceColors 把整個正／反面塗滿能源青（{ pz: TECH_COLOR, nz: TECH_COLOR }），
 * 從遠處或特定角度看起來像一片純色平板，而非「有機械細節的門」——與武器 viewmodel 的小面積
 * 頂面色塊不同，門板尺寸大（3m×3.2m），整面塗色會過度顯眼。改為窄條裝飾（中央滑縫加狀態
 * 指示條），金屬色仍占主要面積，遠看更像門而非一塊實心色板。
 */
export function generateDoorMesh(): DoorMesh {
  stream("prop.door");
  const target: BuildTarget = { vertices: [], indices: [] };

  const half = { x: DOOR_PANEL_HALF_WIDTH, y: DOOR_PANEL_HALF_HEIGHT, z: DOOR_PANEL_HALF_THICKNESS };
  const center = { x: 0, y: half.y, z: 0 };
  appendColoredBox(target, center, half, METAL_COLOR);

  // 中央滑縫（雙開門意象）：正反面各一道極窄能源青豎線，微凸出面板，貫穿大半門高。
  const seamHalf = { x: 0.02, y: half.y * 0.92, z: 0.003 };
  appendColoredBox(target, { x: 0, y: half.y, z: half.z + seamHalf.z }, seamHalf, TECH_COLOR);
  appendColoredBox(target, { x: 0, y: half.y, z: -(half.z + seamHalf.z) }, seamHalf, TECH_COLOR);

  // 狀態指示條：面板中段一道細長能源青橫條，供玩家一眼辨識這是機關門而非普通牆面。
  const stripeHalf = { x: half.x * 0.55, y: 0.04, z: 0.003 };
  appendColoredBox(target, { x: 0, y: half.y * 1.2, z: half.z + stripeHalf.z }, stripeHalf, TECH_COLOR);
  appendColoredBox(target, { x: 0, y: half.y * 1.2, z: -(half.z + stripeHalf.z) }, stripeHalf, TECH_COLOR);

  return { vertices: new Float32Array(target.vertices), indices: new Uint32Array(target.indices) };
}
