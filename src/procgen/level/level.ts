// 程序化關卡：M2 垂直切片主體。區域 A（甦醒室）→ 通道 A-B（L 形轉折走廊，視線遮斷）→
// 區域 B（維修走廊，兩側凹龕）→ 門 B → 區域 C（熔爐大廳，垂直空間加伏擊）→ 終點門 → 終點觸發區。
// 取代 M0/M1 的測試房（generateTestRoom／room.ts 已淘汰並整檔刪除，VERTEX_STRIDE 與 Aabb
// 兩個共用匯出改落腳本檔，供 renderer／weapons／collision／enemy 等模組改 import 此檔）。
//
// 純 CPU 決定性鐵則：本模組禁止使用 Math.random、禁止使用 Date。本關卡是手工設計的固定
// 平面圖（非隨機生成），輸入本身即為常數，天生決定性；levelHash 仍對全部玩法資料（碰撞、
// 門、撿取物、敵人配置、玩家出生點、終點觸發區）計算雜湊，供跨機一致性驗證與日後改動的
// 回歸偵測（PLAN §6.4），沿用 room.ts 對固定牆面規格計算雜湊的既有慣例（固定值一樣要入雜湊，
// 不是只有 rng 產出的值才算）。

import { fnv1a } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** interleaved 頂點格式：position(3) + normal(3) + uv(2) = 8 float / 頂點（沿用 M0 慣例）。 */
export const VERTEX_STRIDE = 8;

export type DoorOpenCondition = "has-weapon" | "area-clear:B" | "area-clear:C" | "console-activated" | "area-clear:E" | "none";

export interface DoorDef {
  id: string;
  /** 門板底部中心世界座標（y=0 為地面）。 */
  pos: Vec3;
  /** 門朝向：0＝寬度沿 X 軸（如門 A），Math.PI/2＝寬度沿 Z 軸（如門 B、終點門）。 */
  yaw: number;
  condition: DoorOpenCondition;
  /** 關閉時的碰撞體；DoorSystem 依開關狀態決定是否計入每幀的 active colliders。 */
  collider: Aabb;
}

export type PickupKind =
  | "weapon-pistol"
  | "weapon-shotgun"
  | "weapon-plasma"
  | "weapon-cannon"
  | "ammo-pistol"
  | "ammo-shotgun"
  | "ammo-plasma"
  | "medkit";

export interface PickupDef {
  id: string;
  kind: PickupKind;
  pos: Vec3;
}

export type EnemyArea = "B" | "C" | "D" | "E";

export interface EnemySpawnDef {
  id: string;
  pos: Vec3;
  area: EnemyArea;
}

/** M3：射擊體（Spitter）出生點，獨立於 EnemySpawnDef（不同敵人類別，見 game/spitter.ts）。 */
export interface SpitterSpawnDef {
  id: string;
  pos: Vec3;
  area: EnemyArea;
}

/** M3 第二階段：守衛體（Warden）出生點，獨立於 EnemySpawnDef／SpitterSpawnDef
 *  （不同敵人類別，見 game/warden.ts）。 */
export interface WardenSpawnDef {
  id: string;
  pos: Vec3;
  area: EnemyArea;
}

/** M3：控制台互動點（區域 D 開門機關，見 game/console.ts）。 */
export interface ConsoleDef {
  id: string;
  pos: Vec3;
}

export interface LevelData {
  floorVertices: Float32Array;
  floorIndices: Uint32Array;
  wallVertices: Float32Array;
  wallIndices: Uint32Array;
  ceilingVertices: Float32Array;
  ceilingIndices: Uint32Array;
  /** 靜態關卡碰撞體（牆面、柱子、台座、門楣）；不含門本身（門另由 DoorSystem 動態併入）。 */
  colliders: Aabb[];
  doors: DoorDef[];
  pickups: PickupDef[];
  enemySpawns: EnemySpawnDef[];
  /** M3 新增：射擊體出生點（區域 D、E）。 */
  spitterSpawns: SpitterSpawnDef[];
  /** M3 第二階段新增：守衛體出生點（區域 E）。 */
  wardenSpawns: WardenSpawnDef[];
  /** M3 新增：區域 D 控制台互動點。 */
  consoleDef: ConsoleDef;
  /** M3 第三階段新增：區域 F 首領固定平台點（4 至 5 個，見 game/boss.ts 平台移動邏輯），
   *  索引 0 為首領初始所在點（緊鄰能源核心視覺結構）。取代已移除的 endTrigger 機制——
   *  通關改由首領死亡觸發（見 main.ts），本檔不再產生任何「走進去即通關」的觸發區。 */
  bossPlatforms: Vec3[];
  /** M3 第三階段新增：能源核心視覺結構（procgen/mesh/energy-core.ts）世界座標，緊鄰
   *  bossPlatforms[0]，達成「戰鬥中核心與首領一體」的視覺呈現（本次派工規格）。 */
  energyCorePos: Vec3;
  playerSpawn: Vec3;
  levelHash: string;
}

// ---- 共用建模工具（沿用已刪除 room.ts 的 appendBox／aabbFromCenterHalf，邏輯不變）----

interface BoxBuildResult {
  vertices: number[];
  indices: number[];
}

function appendBox(target: BoxBuildResult, center: Vec3, half: Vec3): void {
  const { x: cx, y: cy, z: cz } = center;
  const { x: hx, y: hy, z: hz } = half;

  type Face = { normal: [number, number, number]; corners: [number, number, number][] };

  const faces: Face[] = [
    {
      normal: [1, 0, 0],
      corners: [
        [cx + hx, cy - hy, cz - hz],
        [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy + hy, cz + hz],
        [cx + hx, cy + hy, cz - hz],
      ],
    },
    {
      normal: [-1, 0, 0],
      corners: [
        [cx - hx, cy - hy, cz + hz],
        [cx - hx, cy - hy, cz - hz],
        [cx - hx, cy + hy, cz - hz],
        [cx - hx, cy + hy, cz + hz],
      ],
    },
    {
      normal: [0, 1, 0],
      corners: [
        [cx - hx, cy + hy, cz - hz],
        [cx + hx, cy + hy, cz - hz],
        [cx + hx, cy + hy, cz + hz],
        [cx - hx, cy + hy, cz + hz],
      ],
    },
    {
      normal: [0, -1, 0],
      corners: [
        [cx - hx, cy - hy, cz + hz],
        [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy - hy, cz - hz],
        [cx - hx, cy - hy, cz - hz],
      ],
    },
    {
      normal: [0, 0, 1],
      corners: [
        [cx + hx, cy - hy, cz + hz],
        [cx - hx, cy - hy, cz + hz],
        [cx - hx, cy + hy, cz + hz],
        [cx + hx, cy + hy, cz + hz],
      ],
    },
    {
      normal: [0, 0, -1],
      corners: [
        [cx - hx, cy - hy, cz - hz],
        [cx + hx, cy - hy, cz - hz],
        [cx + hx, cy + hy, cz - hz],
        [cx - hx, cy + hy, cz - hz],
      ],
    },
  ];

  const uvs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  for (const face of faces) {
    const baseIndex = target.vertices.length / VERTEX_STRIDE;
    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = face.corners[i];
      const [nx, ny, nz] = face.normal;
      const [u, v] = uvs[i];
      target.vertices.push(px, py, pz, nx, ny, nz, u, v);
    }
    target.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
  }
}

function aabbFromCenterHalf(center: Vec3, half: Vec3): Aabb {
  return {
    min: { x: center.x - half.x, y: center.y - half.y, z: center.z - half.z },
    max: { x: center.x + half.x, y: center.y + half.y, z: center.z + half.z },
  };
}

interface BoxSpec {
  center: Vec3;
  half: Vec3;
}

function b(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): BoxSpec {
  return { center: { x: cx, y: cy, z: cz }, half: { x: hx, y: hy, z: hz } };
}

/** 附加一個牆面／柱體／台座 box：寫入 wallTarget 幾何並登記為碰撞體。 */
function addSolid(wallTarget: BoxBuildResult, colliders: Aabb[], spec: BoxSpec): void {
  appendBox(wallTarget, spec.center, spec.half);
  colliders.push(aabbFromCenterHalf(spec.center, spec.half));
}

/** 附加一段地板／天花板 box：地板需登記碰撞體（供重力／站立），天花板純視覺不登記
 *  （玩家無跳躍能力，構造上不可能觸及，沿用 room.ts 既有慣例）。 */
function addFloorCeiling(
  floorTarget: BoxBuildResult,
  ceilingTarget: BoxBuildResult,
  colliders: Aabb[],
  footprint: { cx: number; cz: number; hx: number; hz: number },
  floorY: number,
  ceilingY: number,
): void {
  const floorSpec = b(footprint.cx, floorY - 0.1, footprint.cz, footprint.hx, 0.1, footprint.hz);
  appendBox(floorTarget, floorSpec.center, floorSpec.half);
  colliders.push(aabbFromCenterHalf(floorSpec.center, floorSpec.half));

  const ceilingSpec = b(footprint.cx, ceilingY + 0.1, footprint.cz, footprint.hx, 0.1, footprint.hz);
  appendBox(ceilingTarget, ceilingSpec.center, ceilingSpec.half);
}

// ---- 關卡尺寸常數（PLAN §4.2 主題延伸；本次派工規格 §一 平面圖，尺寸可微調 ±20%）----

const WALL_T = 0.15; // 牆面半厚
const H_LOW = 4; // 區域 A／通道／區域 B 牆高
const H_TALL = 7; // 區域 C 牆高（垂直空間感）
const DOOR_HALF_WIDTH = 1.5; // 門與對應通道寬度統一 3m（半寬 1.5m）
const DOOR_HALF_HEIGHT = 1.6; // 門板高 3.2m
const DOOR_HALF_THICKNESS = 0.125;
const DOOR_SLIDE_DISTANCE = DOOR_HALF_HEIGHT * 2; // 滑開距離＝門板自身高度，完全讓出開口

export const DOOR_OPEN_SLIDE_DISTANCE = DOOR_SLIDE_DISTANCE;
export const DOOR_PANEL_HALF_WIDTH = DOOR_HALF_WIDTH;
export const DOOR_PANEL_HALF_HEIGHT = DOOR_HALF_HEIGHT;
export const DOOR_PANEL_HALF_THICKNESS = DOOR_HALF_THICKNESS;

/** 產生 M2 垂直切片主關卡：地板／牆面／天花板幾何、碰撞、門、撿取物、敵人配置、
 *  玩家出生點、終點觸發區與 levelHash。純函式，同輸入（無輸入）恆同輸出。 */
export function generateLevel(): LevelData {
  const floorTarget: BoxBuildResult = { vertices: [], indices: [] };
  const wallTarget: BoxBuildResult = { vertices: [], indices: [] };
  const ceilingTarget: BoxBuildResult = { vertices: [], indices: [] };
  const colliders: Aabb[] = [];

  // ============================================================
  // 區域 A：甦醒室（8×8m，牆高 4m）。X:[-4,4] Z:[-4,4]，北出口（-Z）通往走廊。
  // ============================================================
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 0, cz: 0, hx: 4, hz: 4 }, 0, H_LOW);

  // 北牆（z=-4）：中央 x:[-1.5,1.5] 留給門 A，兩側實牆。
  addSolid(wallTarget, colliders, b(-2.75, H_LOW / 2, -4, 1.25, H_LOW / 2, WALL_T));
  addSolid(wallTarget, colliders, b(2.75, H_LOW / 2, -4, 1.25, H_LOW / 2, WALL_T));
  // 門 A 門楣（門板高 3.2m，其上至牆頂 0.8m 用實牆封住）。
  addSolid(wallTarget, colliders, b(0, DOOR_HALF_HEIGHT * 2 + 0.4, -4, DOOR_HALF_WIDTH, 0.4, WALL_T));
  // 南牆／東牆／西牆：整面實牆（含轉角延伸，避免角落漏縫）。
  addSolid(wallTarget, colliders, b(0, H_LOW / 2, 4, 4 + WALL_T, H_LOW / 2, WALL_T));
  addSolid(wallTarget, colliders, b(4, H_LOW / 2, 0, WALL_T, H_LOW / 2, 4 + WALL_T));
  addSolid(wallTarget, colliders, b(-4, H_LOW / 2, 0, WALL_T, H_LOW / 2, 4 + WALL_T));

  // 武器台座（小方柱，撿取前不可開火；上方浮動旋轉脈衝手槍模型見 main.ts renderProps）。
  addSolid(wallTarget, colliders, b(0, 0.4, -2.2, 0.3, 0.4, 0.3));

  const playerSpawn: Vec3 = { x: 0, y: 0, z: 2.4 };

  const doorA: DoorDef = {
    id: "door-a",
    pos: { x: 0, y: 0, z: -4 },
    yaw: 0,
    condition: "has-weapon",
    collider: aabbFromCenterHalf({ x: 0, y: DOOR_HALF_HEIGHT, z: -4 }, { x: DOOR_HALF_WIDTH, y: DOOR_HALF_HEIGHT, z: DOOR_HALF_THICKNESS }),
  };

  const pistolPickup: PickupDef = { id: "pickup-pistol", kind: "weapon-pistol", pos: { x: 0, y: 0, z: -2.2 } };

  // ============================================================
  // 通道 A→B：L 形轉折走廊，寬 3m，總長約 12m（轉折製造視線遮斷）。
  // 段一（南北向）：X:[-1.5,1.5] Z:[-8.5,-4]；段二（東西向，含轉角）：X:[-1.5,6] Z:[-11.5,-8.5]。
  // ============================================================
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 0, cz: -6.25, hx: 1.5, hz: 2.25 }, 0, H_LOW);
  addSolid(wallTarget, colliders, b(-1.5 - WALL_T, H_LOW / 2, -6.25, WALL_T, H_LOW / 2, 2.25)); // 西壁
  addSolid(wallTarget, colliders, b(1.5 + WALL_T, H_LOW / 2, -6.25, WALL_T, H_LOW / 2, 2.25)); // 東壁

  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 2.25, cz: -10, hx: 3.75, hz: 1.5 }, 0, H_LOW);
  addSolid(wallTarget, colliders, b(2.25, H_LOW / 2, -11.5 - WALL_T, 3.75, H_LOW / 2, WALL_T)); // 北壁（轉角段）
  addSolid(wallTarget, colliders, b(3.75, H_LOW / 2, -8.5 + WALL_T, 2.25, H_LOW / 2, WALL_T)); // 南壁（僅 x:[1.5,6] 段，x:[-1.5,1.5] 留給段一銜接）
  addSolid(wallTarget, colliders, b(-1.5 - WALL_T, H_LOW / 2, -10, WALL_T, H_LOW / 2, 1.5)); // 西端死巷封牆

  // ============================================================
  // 區域 B：維修走廊（4×20m，兩側各一凹龕，3 隻巡行體，彈藥×2）。X:[6,26] Z:[-12,-8]。
  // ============================================================
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 16, cz: -10, hx: 10, hz: 2 }, 0, H_LOW);

  // 西端封牆（僅留 z:[-11.5,-8.5] 銜接通道段二，寬度對齊 3m 走廊）。
  addSolid(wallTarget, colliders, b(6 - WALL_T, H_LOW / 2, -11.75, WALL_T, H_LOW / 2, 0.25));
  addSolid(wallTarget, colliders, b(6 - WALL_T, H_LOW / 2, -8.25, WALL_T, H_LOW / 2, 0.25));

  // 北側凹龕：x:[11,14]，深 1m（z:-12 → z:-13）。
  addSolid(wallTarget, colliders, b(8.5, H_LOW / 2, -12 - WALL_T, 2.5, H_LOW / 2, WALL_T)); // 北牆左段
  addSolid(wallTarget, colliders, b(20, H_LOW / 2, -12 - WALL_T, 6, H_LOW / 2, WALL_T)); // 北牆右段
  addSolid(wallTarget, colliders, b(12.5, H_LOW / 2, -13 - WALL_T, 1.5, H_LOW / 2, WALL_T)); // 凹龕後牆
  addSolid(wallTarget, colliders, b(11, H_LOW / 2, -12.5, WALL_T, H_LOW / 2, 0.5)); // 凹龕側牆（西）
  addSolid(wallTarget, colliders, b(14, H_LOW / 2, -12.5, WALL_T, H_LOW / 2, 0.5)); // 凹龕側牆（東）
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 12.5, cz: -12.5, hx: 1.5, hz: 0.5 }, 0, H_LOW);

  // 南側凹龕：x:[18,21]，深 1m（z:-8 → z:-7）。
  addSolid(wallTarget, colliders, b(12, H_LOW / 2, -8 + WALL_T, 6, H_LOW / 2, WALL_T)); // 南牆左段
  addSolid(wallTarget, colliders, b(23.5, H_LOW / 2, -8 + WALL_T, 2.5, H_LOW / 2, WALL_T)); // 南牆右段
  addSolid(wallTarget, colliders, b(19.5, H_LOW / 2, -7 + WALL_T, 1.5, H_LOW / 2, WALL_T)); // 凹龕後牆
  addSolid(wallTarget, colliders, b(18, H_LOW / 2, -7.5, WALL_T, H_LOW / 2, 0.5)); // 凹龕側牆（西）
  addSolid(wallTarget, colliders, b(21, H_LOW / 2, -7.5, WALL_T, H_LOW / 2, 0.5)); // 凹龕側牆（東）
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 19.5, cz: -7.5, hx: 1.5, hz: 0.5 }, 0, H_LOW);

  // 東端牆：留中央 z:[-11.5,-8.5] 給門 B，兩側僅剩 0.5m 短牆墩（對齊西端封牆的作法）。
  addSolid(wallTarget, colliders, b(26 + WALL_T, H_LOW / 2, -11.75, WALL_T, H_LOW / 2, 0.25)); // 北段
  addSolid(wallTarget, colliders, b(26 + WALL_T, H_LOW / 2, -8.25, WALL_T, H_LOW / 2, 0.25)); // 南段
  // 門 B 門楣。
  addSolid(wallTarget, colliders, b(26 + WALL_T, DOOR_HALF_HEIGHT * 2 + 0.4, -10, WALL_T, 0.4, DOOR_HALF_WIDTH));

  const enemiesB: EnemySpawnDef[] = [
    { id: "crawler-b0", pos: { x: 9, y: 0, z: -10 }, area: "B" },
    { id: "crawler-b1", pos: { x: 16, y: 0, z: -9 }, area: "B" },
    { id: "crawler-b2", pos: { x: 23, y: 0, z: -10 }, area: "B" },
  ];

  const pickupsB: PickupDef[] = [
    { id: "pickup-ammo-b0", kind: "ammo-pistol", pos: { x: 12.5, y: 0, z: -12.4 } },
    { id: "pickup-ammo-b1", kind: "ammo-pistol", pos: { x: 19.5, y: 0, z: -7.4 } },
  ];

  const doorB: DoorDef = {
    id: "door-b",
    pos: { x: 26, y: 0, z: -10 },
    yaw: Math.PI / 2,
    condition: "area-clear:B",
    collider: aabbFromCenterHalf({ x: 26, y: DOOR_HALF_HEIGHT, z: -10 }, { x: DOOR_HALF_THICKNESS, y: DOOR_HALF_HEIGHT, z: DOOR_HALF_WIDTH }),
  };

  // ============================================================
  // 區域 C：熔爐大廳（18×14m，牆高 7m）。X:[26,44] Z:[-17,-3]。3 至 4 根方柱掩體，
  // 散射槍中段台座（撿起觸發伏擊，6 隻巡行體自週邊直接進 chase）。醫療×2、彈藥×2。
  // ============================================================
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 35, cz: -10, hx: 9, hz: 7 }, 0, H_TALL);

  // 西牆：門 B 涵蓋範圍（z:[-11.5,-8.5]）由區域 B 自身牆體與門楣封頂，此處補上區域 C
  // 較寬（14m）超出區域 B 寬度（4m）以外的兩段（全高 7m）。
  addSolid(wallTarget, colliders, b(26 + WALL_T, H_TALL / 2, -14.5, WALL_T, H_TALL / 2, 2.5));
  addSolid(wallTarget, colliders, b(26 + WALL_T, H_TALL / 2, -5.5, WALL_T, H_TALL / 2, 2.5));

  addSolid(wallTarget, colliders, b(35, H_TALL / 2, -17 - WALL_T, 9, H_TALL / 2, WALL_T)); // 北牆
  addSolid(wallTarget, colliders, b(35, H_TALL / 2, -3 + WALL_T, 9, H_TALL / 2, WALL_T)); // 南牆

  // 東牆：留中央 z:[-11.5,-8.5] 給終點門。
  addSolid(wallTarget, colliders, b(44 + WALL_T, H_TALL / 2, -14.25, WALL_T, H_TALL / 2, 2.75));
  addSolid(wallTarget, colliders, b(44 + WALL_T, H_TALL / 2, -5.75, WALL_T, H_TALL / 2, 2.75));
  // 終點門門楣（區域 C 牆高 7m，門板僅 3.2m，其上至頂皆需封住）。
  addSolid(
    wallTarget,
    colliders,
    b(44 + WALL_T, DOOR_HALF_HEIGHT * 2 + (H_TALL - DOOR_HALF_HEIGHT * 2) / 2, -10, WALL_T, (H_TALL - DOOR_HALF_HEIGHT * 2) / 2, DOOR_HALF_WIDTH),
  );

  // 方柱掩體 ×4（全高 7m）。
  const pillarPositions: [number, number][] = [
    [32, -13],
    [32, -7],
    [38, -13],
    [38, -7],
  ];
  for (const [px, pz] of pillarPositions) {
    addSolid(wallTarget, colliders, b(px, H_TALL / 2, pz, 0.6, H_TALL / 2, 0.6));
  }

  // 散射槍台座（小方柱）。
  addSolid(wallTarget, colliders, b(35, 0.4, -10, 0.3, 0.4, 0.3));

  const shotgunPickup: PickupDef = { id: "pickup-shotgun", kind: "weapon-shotgun", pos: { x: 35, y: 0, z: -10 } };

  const pickupsC: PickupDef[] = [
    { id: "pickup-medkit-c0", kind: "medkit", pos: { x: 30, y: 0, z: -10 } },
    { id: "pickup-medkit-c1", kind: "medkit", pos: { x: 40, y: 0, z: -10 } },
    { id: "pickup-ammo-c0", kind: "ammo-shotgun", pos: { x: 35, y: 0, z: -15 } },
    { id: "pickup-ammo-c1", kind: "ammo-shotgun", pos: { x: 35, y: 0, z: -5 } },
  ];

  // 伏擊組：出生位置環繞大廳週邊（撿起散射槍時才實際建立實體，見 main.ts）。
  const enemiesC: EnemySpawnDef[] = [
    { id: "crawler-c0", pos: { x: 29, y: 0, z: -15 }, area: "C" },
    { id: "crawler-c1", pos: { x: 41, y: 0, z: -15 }, area: "C" },
    { id: "crawler-c2", pos: { x: 29, y: 0, z: -5 }, area: "C" },
    { id: "crawler-c3", pos: { x: 41, y: 0, z: -5 }, area: "C" },
    { id: "crawler-c4", pos: { x: 35, y: 0, z: -15.5 }, area: "C" },
    { id: "crawler-c5", pos: { x: 35, y: 0, z: -4.5 }, area: "C" },
  ];

  const doorC: DoorDef = {
    id: "door-c",
    pos: { x: 44, y: 0, z: -10 },
    yaw: Math.PI / 2,
    condition: "area-clear:C",
    collider: aabbFromCenterHalf({ x: 44, y: DOOR_HALF_HEIGHT, z: -10 }, { x: DOOR_HALF_THICKNESS, y: DOOR_HALF_HEIGHT, z: DOOR_HALF_WIDTH }),
  };

  // ============================================================
  // 通道 C→D：door-c 之後的收尾轉接空間，4m 寬，東側直接敞開銜接區域 D（無獨立門，
  // 純敘事轉場）。X:[44,48] Z:[-12,-8]。
  // ============================================================
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 46, cz: -10, hx: 2, hz: 2 }, 0, H_TALL);
  addSolid(wallTarget, colliders, b(46, H_TALL / 2, -12 - WALL_T, 2 + WALL_T, H_TALL / 2, WALL_T));
  addSolid(wallTarget, colliders, b(46, H_TALL / 2, -8 + WALL_T, 2 + WALL_T, H_TALL / 2, WALL_T));

  // ============================================================
  // 區域 D：控制區（14×10m，牆高沿用區域 C 的 7m，降低結構複雜度與回歸風險）。
  // X:[48,62] Z:[-15,-5]，中心 (55,-10)。兩側各一 0.8m 高平台（玩家無跳躍能力天然不可
  // 攀爬，PLAN §3.2 D-005，碰撞純用於「可繞行不可上」）；中央偏後（靠近 door-d 一側）
  // 設控制台，啟動後解鎖 door-d。3 隻射擊體分散於平台週邊掩體後。
  // ============================================================
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 55, cz: -10, hx: 7, hz: 5 }, 0, H_TALL);

  addSolid(wallTarget, colliders, b(55, H_TALL / 2, -15 - WALL_T, 7, H_TALL / 2, WALL_T)); // 北牆
  addSolid(wallTarget, colliders, b(55, H_TALL / 2, -5 + WALL_T, 7, H_TALL / 2, WALL_T)); // 南牆

  // 西牆：留中央 z:[-12,-8]（4m）銜接通道 C→D，兩側實牆。
  addSolid(wallTarget, colliders, b(48 + WALL_T, H_TALL / 2, -13.5, WALL_T, H_TALL / 2, 1.5));
  addSolid(wallTarget, colliders, b(48 + WALL_T, H_TALL / 2, -6.5, WALL_T, H_TALL / 2, 1.5));

  // 東牆：留中央 z:[-11.5,-8.5] 給 door-d，兩側實牆。
  addSolid(wallTarget, colliders, b(62 + WALL_T, H_TALL / 2, -13.25, WALL_T, H_TALL / 2, 1.75));
  addSolid(wallTarget, colliders, b(62 + WALL_T, H_TALL / 2, -6.75, WALL_T, H_TALL / 2, 1.75));
  // door-d 門楣（區域 D 牆高 7m，門板僅 3.2m，其上至頂皆需封住）。
  addSolid(
    wallTarget,
    colliders,
    b(62 + WALL_T, DOOR_HALF_HEIGHT * 2 + (H_TALL - DOOR_HALF_HEIGHT * 2) / 2, -10, WALL_T, (H_TALL - DOOR_HALF_HEIGHT * 2) / 2, DOOR_HALF_WIDTH),
  );

  // 兩側平台（高 0.8m）：玩家可繞行但不可上，用碰撞擋。
  const PLATFORM_HALF_HEIGHT = 0.4;
  addSolid(wallTarget, colliders, b(55, PLATFORM_HALF_HEIGHT, -13, 5, PLATFORM_HALF_HEIGHT, 1)); // 北側平台 x:[50,60] z:[-14,-12]
  addSolid(wallTarget, colliders, b(55, PLATFORM_HALF_HEIGHT, -7, 5, PLATFORM_HALF_HEIGHT, 1)); // 南側平台 x:[50,60] z:[-8,-6]

  // 控制台：中央偏後（靠近 door-d 一側），只登記碰撞體（視覺由 main.ts 用專屬 prop 網格
  // 渲染，見 procgen/mesh/console.ts，不與 addSolid 的通用牆面材質重疊）。
  const consolePos: Vec3 = { x: 58, y: 0, z: -10 };
  colliders.push(aabbFromCenterHalf({ x: 58, y: 0.42, z: -10 }, { x: 0.55, y: 0.42, z: 0.4 }));
  const consoleDef: ConsoleDef = { id: "console-d", pos: consolePos };

  const doorD: DoorDef = {
    id: "door-d",
    pos: { x: 62, y: 0, z: -10 },
    yaw: Math.PI / 2,
    condition: "console-activated",
    collider: aabbFromCenterHalf({ x: 62, y: DOOR_HALF_HEIGHT, z: -10 }, { x: DOOR_HALF_THICKNESS, y: DOOR_HALF_HEIGHT, z: DOOR_HALF_WIDTH }),
  };

  // 射擊體 ×3：站位偏平台與掩體後（PLAN §3.4；本次派工規格：door-d 只看控制台不要求清敵，
  // 但站位設計成不清敵很難安全走到控制台按下啟動）。z 座標與平台邊緣（z:-12／z:-8）保留
  // 至少 0.6m 淨空（SPITTER_HALF.z=0.38 加安全餘量），避免出生時碰撞體與平台重疊導致移動
  // 解算卡死（M3 實測發現：z:-11.7／-8.3 與平台邊界僅差 0.08m 會直接重疊）。
  const spitterSpawns: SpitterSpawnDef[] = [
    { id: "spitter-d0", pos: { x: 51, y: 0, z: -11.0 }, area: "D" },
    { id: "spitter-d1", pos: { x: 51, y: 0, z: -9.0 }, area: "D" },
    { id: "spitter-d2", pos: { x: 59, y: 0, z: -11.0 }, area: "D" },
  ];

  // ============================================================
  // 區域 E：核心通道（M3 第二階段）。door-d 之後的終點小空間改建為此區：約 24×6m
  // （X:[62,86] Z:[-13,-7]），牆高 5m（H_E，低於區域 C／D 的 7m，長廊壓迫感），
  // 兩側交錯凹龕與柱體（掩體節奏：北凹龕 → 柱 → 南凹龕 → 柱）。西側與 door-d
  // 共用區域 D 既有東牆（含門楣，已於上方區域 D 區塊建妥，此處不重複建牆）。
  // 電漿步槍位於前段台座；彈藥 ammo-plasma ×2、醫療 ×1 沿途；4 巡行體＋2 射擊體＋
  // 1 守衛體混編於中後段。尾端 door-e（條件 area-clear:E）通往終點小室與新 endTrigger。
  // ============================================================
  const H_E = 5; // 區域 E 牆高（低於區域 C／D 的 7m，長廊壓迫感，本次派工規格）

  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 74, cz: -10, hx: 12, hz: 3 }, 0, H_E);

  // 北牆（z=-13）：中央 x:[66,69] 留給北凹龕入口，兩側實牆。
  addSolid(wallTarget, colliders, b(64, H_E / 2, -13 - WALL_T, 2, H_E / 2, WALL_T)); // x:[62,66]
  addSolid(wallTarget, colliders, b(77.5, H_E / 2, -13 - WALL_T, 8.5, H_E / 2, WALL_T)); // x:[69,86]

  // 南牆（z=-7）：中央 x:[75,78] 留給南凹龕入口，兩側實牆。
  addSolid(wallTarget, colliders, b(68.5, H_E / 2, -7 + WALL_T, 6.5, H_E / 2, WALL_T)); // x:[62,75]
  addSolid(wallTarget, colliders, b(82, H_E / 2, -7 + WALL_T, 4, H_E / 2, WALL_T)); // x:[78,86]

  // 北凹龕：x:[66,69]，深 1m（z:-13 → z:-14）。
  addSolid(wallTarget, colliders, b(67.5, H_E / 2, -14 - WALL_T, 1.5, H_E / 2, WALL_T)); // 凹龕後牆
  addSolid(wallTarget, colliders, b(66, H_E / 2, -13.5, WALL_T, H_E / 2, 0.5)); // 凹龕側牆（西）
  addSolid(wallTarget, colliders, b(69, H_E / 2, -13.5, WALL_T, H_E / 2, 0.5)); // 凹龕側牆（東）
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 67.5, cz: -13.5, hx: 1.5, hz: 0.5 }, 0, H_E);

  // 南凹龕：x:[75,78]，深 1m（z:-7 → z:-6）。
  addSolid(wallTarget, colliders, b(76.5, H_E / 2, -6 + WALL_T, 1.5, H_E / 2, WALL_T)); // 凹龕後牆
  addSolid(wallTarget, colliders, b(75, H_E / 2, -6.5, WALL_T, H_E / 2, 0.5)); // 凹龕側牆（西）
  addSolid(wallTarget, colliders, b(78, H_E / 2, -6.5, WALL_T, H_E / 2, 0.5)); // 凹龕側牆（東）
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 76.5, cz: -6.5, hx: 1.5, hz: 0.5 }, 0, H_E);

  // 柱體掩體 ×2（全高 H_E，與凹龕交錯：柱 1 近北凹龕之後偏南，柱 2 近南凹龕之後偏北）。
  addSolid(wallTarget, colliders, b(72, H_E / 2, -8.3, 0.5, H_E / 2, 0.5));
  addSolid(wallTarget, colliders, b(81, H_E / 2, -11.7, 0.5, H_E / 2, 0.5));

  // 東牆：留中央 z:[-11.5,-8.5] 給 door-e，兩側實牆。
  addSolid(wallTarget, colliders, b(86 + WALL_T, H_E / 2, -12.25, WALL_T, H_E / 2, 0.75));
  addSolid(wallTarget, colliders, b(86 + WALL_T, H_E / 2, -7.75, WALL_T, H_E / 2, 0.75));
  // door-e 門楣（區域 E 牆高 5m，門板僅 3.2m，其上至頂皆需封住）。
  addSolid(
    wallTarget,
    colliders,
    b(86 + WALL_T, DOOR_HALF_HEIGHT * 2 + (H_E - DOOR_HALF_HEIGHT * 2) / 2, -10, WALL_T, (H_E - DOOR_HALF_HEIGHT * 2) / 2, DOOR_HALF_WIDTH),
  );

  // 電漿步槍台座（小方柱，前段，door-d 之後不遠）。
  addSolid(wallTarget, colliders, b(65, 0.4, -10, 0.3, 0.4, 0.3));
  const plasmaPickup: PickupDef = { id: "pickup-plasma", kind: "weapon-plasma", pos: { x: 65, y: 0, z: -10 } };

  const pickupsE: PickupDef[] = [
    { id: "pickup-ammo-e0", kind: "ammo-plasma", pos: { x: 71, y: 0, z: -9.5 } },
    { id: "pickup-ammo-e1", kind: "ammo-plasma", pos: { x: 82, y: 0, z: -10.5 } },
    { id: "pickup-medkit-e0", kind: "medkit", pos: { x: 77, y: 0, z: -10 } },
  ];

  // 敵人混編（中後段，交錯南北兩側，避開柱體與凹龕入口）：4 巡行體＋2 射擊體＋1 守衛體。
  const enemiesE: EnemySpawnDef[] = [
    { id: "crawler-e0", pos: { x: 68, y: 0, z: -8.5 }, area: "E" },
    { id: "crawler-e1", pos: { x: 70, y: 0, z: -11.5 }, area: "E" },
    { id: "crawler-e2", pos: { x: 79, y: 0, z: -11.5 }, area: "E" },
    { id: "crawler-e3", pos: { x: 81.5, y: 0, z: -8.5 }, area: "E" },
  ];
  const spittersE: SpitterSpawnDef[] = [
    { id: "spitter-e0", pos: { x: 73, y: 0, z: -11.5 }, area: "E" },
    { id: "spitter-e1", pos: { x: 76, y: 0, z: -8.5 }, area: "E" },
  ];
  const wardensE: WardenSpawnDef[] = [{ id: "warden-e0", pos: { x: 84, y: 0, z: -10 }, area: "E" }];

  const doorE: DoorDef = {
    id: "door-e",
    pos: { x: 86, y: 0, z: -10 },
    yaw: Math.PI / 2,
    condition: "area-clear:E",
    collider: aabbFromCenterHalf({ x: 86, y: DOOR_HALF_HEIGHT, z: -10 }, { x: DOOR_HALF_THICKNESS, y: DOOR_HALF_HEIGHT, z: DOOR_HALF_WIDTH }),
  };

  // ============================================================
  // 區域 F 前廳（M3 第三階段）：door-e 之後的收尾空間改建為此區，取代已移除的暫時終點小室。
  // 小房間，X:[86,98] Z:[-13,-7]（沿用區域 E 寬度與牆高 H_E，降低結構複雜度），能量砲台座
  // 加彈藥醫療補給站。尾端 door-f 為「大門」：無條件（condition "none"，走近即開），
  // 玩家進入區域 F 大廳後由 main.ts 呼叫 DoorSystem.lock() 永久鎖住直到首領死亡
  // （見 game/doors.ts locked 欄位；本檔只負責幾何與門定義本身，鎖定行為屬執行期邏輯）。
  // ============================================================
  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: 92, cz: -10, hx: 6, hz: 3 }, 0, H_E);
  addSolid(wallTarget, colliders, b(92, H_E / 2, -13 - WALL_T, 6, H_E / 2, WALL_T)); // 北牆
  addSolid(wallTarget, colliders, b(92, H_E / 2, -7 + WALL_T, 6, H_E / 2, WALL_T)); // 南牆
  // 東牆：留中央 z:[-11.5,-8.5] 給 door-f，兩側實牆。
  addSolid(wallTarget, colliders, b(98 + WALL_T, H_E / 2, -12.25, WALL_T, H_E / 2, 0.75));
  addSolid(wallTarget, colliders, b(98 + WALL_T, H_E / 2, -7.75, WALL_T, H_E / 2, 0.75));
  // door-f 門楣。
  addSolid(
    wallTarget,
    colliders,
    b(98 + WALL_T, DOOR_HALF_HEIGHT * 2 + (H_E - DOOR_HALF_HEIGHT * 2) / 2, -10, WALL_T, (H_E - DOOR_HALF_HEIGHT * 2) / 2, DOOR_HALF_WIDTH),
  );

  // 能量砲台座（前段）。
  addSolid(wallTarget, colliders, b(90, 0.4, -10, 0.3, 0.4, 0.3));
  const cannonPickup: PickupDef = { id: "pickup-cannon", kind: "weapon-cannon", pos: { x: 90, y: 0, z: -10 } };

  // 彈藥醫療補給站（本次派工規格：F 前廳含彈藥加醫療補給）。
  const pickupsF: PickupDef[] = [
    { id: "pickup-ammo-f0", kind: "ammo-plasma", pos: { x: 94, y: 0, z: -8.5 } },
    { id: "pickup-medkit-f0", kind: "medkit", pos: { x: 94, y: 0, z: -11.5 } },
  ];

  const doorF: DoorDef = {
    id: "door-f",
    pos: { x: 98, y: 0, z: -10 },
    yaw: Math.PI / 2,
    condition: "none",
    collider: aabbFromCenterHalf({ x: 98, y: DOOR_HALF_HEIGHT, z: -10 }, { x: DOOR_HALF_THICKNESS, y: DOOR_HALF_HEIGHT, z: DOOR_HALF_WIDTH }),
  };

  // ============================================================
  // 區域 F 能源核心（M3 第三階段，首領戰與真結局）：door-f 之後，約 20×20m、高 9m
  // （H_F）。X:[98,118] Z:[-20,0]，中心 (108,-10)。「圓形感」以掩體排布達成而非牆體本身
  // 弧形（appendBox／addSolid 僅支援軸對齊箱體，見檔頭工具函式；旋轉牆體超出既有建模慣例
  // 範圍，本次派工刻意不擴充，改用「方柱陣列排成環狀」營造圓形空間的知覺——玩家在方形牆體
  // 內看到的是環繞四周的柱列，而非牆角本身，此為此引擎限制下的合理妥協）。8 根方柱掩體
  // （明顯多於「至少 6 根」下限）呈環狀分佈於中心半徑 F_PILLAR_RADIUS，任何位置附近皆有掩體
  // 可用（含閃避彈幕與全場脈衝震波，見 game/boss.ts）。
  // ============================================================
  const H_F = 9; // 區域 F 挑高（本次派工規格：高 9m）
  const F_CENTER: Vec3 = { x: 108, y: 0, z: -10 };
  const F_HALF = 10; // 20×20m 之半

  addFloorCeiling(floorTarget, ceilingTarget, colliders, { cx: F_CENTER.x, cz: F_CENTER.z, hx: F_HALF, hz: F_HALF }, 0, H_F);

  // 西牆（x=98）：z 範圍在前廳寬度（z:[-13,-7]）之外者無前廳銜接，需全高（H_F）封死；
  // z 範圍內者下半（y:0～H_E）已由前廳東牆與 door-f 門楣負責，此處只需補封上半
  // （y:H_E～H_F，因前廳天花板僅 H_E=5，需補滿至區域 F 的 H_F=9）。
  addSolid(wallTarget, colliders, b(98 + WALL_T, H_F / 2, -16.5, WALL_T, H_F / 2, 3.5)); // z:[-20,-13]
  addSolid(wallTarget, colliders, b(98 + WALL_T, H_F / 2, -3.5, WALL_T, H_F / 2, 3.5)); // z:[-7,0]
  addSolid(wallTarget, colliders, b(98 + WALL_T, H_E + (H_F - H_E) / 2, -10, WALL_T, (H_F - H_E) / 2, 3)); // z:[-13,-7] 上半封頂

  addSolid(wallTarget, colliders, b(F_CENTER.x, H_F / 2, F_CENTER.z - F_HALF - WALL_T, F_HALF, H_F / 2, WALL_T)); // 北牆
  addSolid(wallTarget, colliders, b(F_CENTER.x, H_F / 2, F_CENTER.z + F_HALF + WALL_T, F_HALF, H_F / 2, WALL_T)); // 南牆
  addSolid(wallTarget, colliders, b(F_CENTER.x + F_HALF + WALL_T, H_F / 2, F_CENTER.z, WALL_T, H_F / 2, F_HALF)); // 東牆（最終牆，無出口）

  // 方柱掩體 ×8（全高 H_F），環狀分佈；angle 起始偏移半步，避開 bossPlatforms 的座標。
  const F_PILLAR_RADIUS = 6.5;
  const F_PILLAR_COUNT = 8;
  const F_PILLAR_HALF = 0.7;
  for (let i = 0; i < F_PILLAR_COUNT; i++) {
    const angle = (i / F_PILLAR_COUNT) * Math.PI * 2 + Math.PI / F_PILLAR_COUNT;
    const px = F_CENTER.x + F_PILLAR_RADIUS * Math.cos(angle);
    const pz = F_CENTER.z + F_PILLAR_RADIUS * Math.sin(angle);
    addSolid(wallTarget, colliders, b(px, H_F / 2, pz, F_PILLAR_HALF, H_F / 2, F_PILLAR_HALF));
  }

  // 首領固定平台點（4 至 5 個，見 game/boss.ts）：索引 0（緊鄰能源核心，東側靠牆）為初始站位，
  // 其餘分散於大廳各處，皆落在方柱環（半徑 F_PILLAR_RADIUS）之內，不與柱體重疊。
  const bossPlatforms: Vec3[] = [
    { x: F_CENTER.x + 5, y: 0, z: F_CENTER.z }, // 0：東側，緊鄰能源核心
    { x: F_CENTER.x, y: 0, z: F_CENTER.z - 4 }, // 1：北側
    { x: F_CENTER.x, y: 0, z: F_CENTER.z + 4 }, // 2：南側
    { x: F_CENTER.x - 5, y: 0, z: F_CENTER.z - 3 }, // 3：西北（近大門）
    { x: F_CENTER.x - 5, y: 0, z: F_CENTER.z + 3 }, // 4：西南（近大門）
  ];

  // 能源核心視覺結構（procgen/mesh/energy-core.ts）：緊鄰 bossPlatforms[0]，達成「戰鬥中核心與
  // 首領一體」的視覺呈現（本次派工規格）。
  const energyCorePos: Vec3 = { x: F_CENTER.x + 7, y: 0, z: F_CENTER.z };

  // ---- 匯總 ----
  const doors: DoorDef[] = [doorA, doorB, doorC, doorD, doorE, doorF];
  const pickups: PickupDef[] = [
    pistolPickup,
    ...pickupsB,
    shotgunPickup,
    ...pickupsC,
    plasmaPickup,
    ...pickupsE,
    cannonPickup,
    ...pickupsF,
  ];
  const enemySpawns: EnemySpawnDef[] = [...enemiesB, ...enemiesC, ...enemiesE];
  const allSpitterSpawns: SpitterSpawnDef[] = [...spitterSpawns, ...spittersE];
  const wardenSpawns: WardenSpawnDef[] = wardensE;

  const levelHash = computeLevelHash(
    colliders,
    doors,
    pickups,
    enemySpawns,
    allSpitterSpawns,
    wardenSpawns,
    consoleDef,
    bossPlatforms,
    energyCorePos,
    playerSpawn,
  );

  return {
    floorVertices: new Float32Array(floorTarget.vertices),
    floorIndices: new Uint32Array(floorTarget.indices),
    wallVertices: new Float32Array(wallTarget.vertices),
    wallIndices: new Uint32Array(wallTarget.indices),
    ceilingVertices: new Float32Array(ceilingTarget.vertices),
    ceilingIndices: new Uint32Array(ceilingTarget.indices),
    colliders,
    doors,
    pickups,
    enemySpawns,
    spitterSpawns: allSpitterSpawns,
    wardenSpawns,
    consoleDef,
    bossPlatforms,
    energyCorePos,
    playerSpawn,
    levelHash,
  };
}

/** 將浮點座標量化為整數（毫米級），供 levelHash 用，避免浮點表示法差異影響決定性。 */
function quantize(n: number): number {
  return Math.round(n * 1000);
}

function pushAabb(parts: number[], aabb: Aabb): void {
  parts.push(quantize(aabb.min.x), quantize(aabb.min.y), quantize(aabb.min.z), quantize(aabb.max.x), quantize(aabb.max.y), quantize(aabb.max.z));
}

function pushVec3(parts: (number | string)[], v: Vec3): void {
  parts.push(quantize(v.x), quantize(v.y), quantize(v.z));
}

function computeLevelHash(
  colliders: Aabb[],
  doors: DoorDef[],
  pickups: PickupDef[],
  enemySpawns: EnemySpawnDef[],
  spitterSpawns: SpitterSpawnDef[],
  wardenSpawns: WardenSpawnDef[],
  consoleDef: ConsoleDef,
  bossPlatforms: Vec3[],
  energyCorePos: Vec3,
  playerSpawn: Vec3,
): string {
  const parts: (number | string)[] = [];
  for (const c of colliders) pushAabb(parts as number[], c);
  for (const d of doors) {
    parts.push(d.id, d.condition, quantize(d.yaw));
    pushVec3(parts, d.pos);
    pushAabb(parts as number[], d.collider);
  }
  for (const p of pickups) {
    parts.push(p.id, p.kind);
    pushVec3(parts, p.pos);
  }
  for (const e of enemySpawns) {
    parts.push(e.id, e.area);
    pushVec3(parts, e.pos);
  }
  for (const s of spitterSpawns) {
    parts.push(s.id, s.area);
    pushVec3(parts, s.pos);
  }
  for (const w of wardenSpawns) {
    parts.push(w.id, w.area);
    pushVec3(parts, w.pos);
  }
  parts.push(consoleDef.id);
  pushVec3(parts, consoleDef.pos);
  for (const bp of bossPlatforms) pushVec3(parts, bp);
  pushVec3(parts, energyCorePos);
  pushVec3(parts, playerSpawn);

  const serialized = parts.join(",");
  const hash = fnv1a(serialized);
  return hash.toString(16).padStart(8, "0");
}
