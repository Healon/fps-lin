// 程序化關卡：M0 測試房。地板 20×20m、四面牆高 4m、3 至 5 個障礙箱，
// 位置與尺寸由 stream('level.main') 決定。
//
// 純 CPU 決定性鐵則：本模組禁止使用 Math.random、禁止使用 Date，
// 所有隨機性一律經由 rng/rng.ts 的 stream() 導出，確保跨機器逐位元一致。

import { type Rng, stream, fnv1a } from "../../rng/rng.ts";
import type { Vec3 } from "../../core/math.ts";

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** interleaved 頂點格式：position(3) + normal(3) + uv(2) = 8 float / 頂點。 */
export const VERTEX_STRIDE = 8;

export interface RoomGeometry {
  /** 地板幾何（單獨材質：texture.floor_planks，見 procgen/texture/floor.ts）。 */
  floorVertices: Float32Array;
  floorIndices: Uint32Array;
  /** 牆面＋障礙箱幾何（共用材質：texture.stone_wall，見 procgen/texture/wall.ts）。 */
  wallVertices: Float32Array;
  wallIndices: Uint32Array;
  /**
   * 天花板幾何：與地板同尺寸腳印、置於牆頂高度，法線朝下。純視覺（補上開放式測試房的
   * 上方虛空，Lin 反饋「整體太暗」的一部分即來自此區塊）；沿用 texture.stone_wall 材質
   * （renderer 端整體壓暗，見 gfx/renderer.ts CEILING_BRIGHTNESS），不另開材質種子。
   * 不設碰撞 AABB：玩家跳躍高度僅 1.2m，構造上不可能觸及 4m 高的天花板。
   */
  ceilingVertices: Float32Array;
  ceilingIndices: Uint32Array;
  colliders: Aabb[];
  floorY: number;
  levelHash: string;
  /** 巡行體出生位置（腳底座標），純 CPU 決定性，計入 levelHash。 */
  enemySpawns: Vec3[];
}

const ROOM_HALF_WIDTH = 10; // 20m 見方，半寬 10m
const ROOM_HALF_DEPTH = 10;
const WALL_HEIGHT = 4;
const WALL_THICKNESS = 0.3;
const FLOOR_THICKNESS = 0.2;

interface BoxBuildResult {
  vertices: number[];
  indices: number[];
}

/** 附加一個立方體（六面，各面獨立法線與 uv）到頂點／索引陣列。 */
function appendBox(target: BoxBuildResult, center: Vec3, half: Vec3): void {
  const { x: cx, y: cy, z: cz } = center;
  const { x: hx, y: hy, z: hz } = half;

  type Face = {
    normal: [number, number, number];
    corners: [number, number, number][];
  };

  const faces: Face[] = [
    // +X
    {
      normal: [1, 0, 0],
      corners: [
        [cx + hx, cy - hy, cz - hz],
        [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy + hy, cz + hz],
        [cx + hx, cy + hy, cz - hz],
      ],
    },
    // -X
    {
      normal: [-1, 0, 0],
      corners: [
        [cx - hx, cy - hy, cz + hz],
        [cx - hx, cy - hy, cz - hz],
        [cx - hx, cy + hy, cz - hz],
        [cx - hx, cy + hy, cz + hz],
      ],
    },
    // +Y（頂）
    {
      normal: [0, 1, 0],
      corners: [
        [cx - hx, cy + hy, cz - hz],
        [cx + hx, cy + hy, cz - hz],
        [cx + hx, cy + hy, cz + hz],
        [cx - hx, cy + hy, cz + hz],
      ],
    },
    // -Y（底）
    {
      normal: [0, -1, 0],
      corners: [
        [cx - hx, cy - hy, cz + hz],
        [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy - hy, cz - hz],
        [cx - hx, cy - hy, cz - hz],
      ],
    },
    // +Z
    {
      normal: [0, 0, 1],
      corners: [
        [cx + hx, cy - hy, cz + hz],
        [cx - hx, cy - hy, cz + hz],
        [cx - hx, cy + hy, cz + hz],
        [cx + hx, cy + hy, cz + hz],
      ],
    },
    // -Z
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

interface ObstacleSpec {
  center: Vec3;
  half: Vec3;
}

function generateObstacles(rng: Rng): ObstacleSpec[] {
  const count = 3 + Math.floor(rng() * 3); // 3 至 5 個（含）
  const obstacles: ObstacleSpec[] = [];
  const margin = 1.5; // 離牆內側的安全邊界
  const maxX = ROOM_HALF_WIDTH - WALL_THICKNESS - margin;
  const maxZ = ROOM_HALF_DEPTH - WALL_THICKNESS - margin;

  for (let i = 0; i < count; i++) {
    const halfX = 0.4 + rng() * 0.6; // 0.8 ~ 2.0m 寬
    const halfZ = 0.4 + rng() * 0.6;
    const halfY = 0.4 + rng() * 0.6; // 0.8 ~ 2.0m 高
    const x = (rng() * 2 - 1) * maxX;
    const z = (rng() * 2 - 1) * maxZ;
    obstacles.push({
      center: { x, y: halfY, z },
      half: { x: halfX, y: halfY, z: halfZ },
    });
  }
  return obstacles;
}

/** 將浮點座標量化為整數（毫米級），供 levelHash 用，避免浮點表示法差異影響決定性。 */
function quantize(n: number): number {
  return Math.round(n * 1000);
}

function computeLevelHash(
  floorSpec: ObstacleSpec,
  wallSpecs: ObstacleSpec[],
  obstacles: ObstacleSpec[],
  enemySpawns: Vec3[],
): string {
  const parts: number[] = [];
  const pushSpec = (spec: ObstacleSpec): void => {
    parts.push(
      quantize(spec.center.x),
      quantize(spec.center.y),
      quantize(spec.center.z),
      quantize(spec.half.x),
      quantize(spec.half.y),
      quantize(spec.half.z),
    );
  };
  pushSpec(floorSpec);
  for (const w of wallSpecs) pushSpec(w);
  for (const o of obstacles) pushSpec(o);
  for (const e of enemySpawns) {
    parts.push(quantize(e.x), quantize(e.y), quantize(e.z));
  }

  const serialized = parts.join(",");
  const hash = fnv1a(serialized);
  return hash.toString(16).padStart(8, "0");
}

const CRAWLER_SPAWN_COUNT = 3;
const CRAWLER_SPAWN_RADIUS_MIN = 4;
const CRAWLER_SPAWN_RADIUS_MAX = 8.5;

/**
 * 巡行體出生位置生成：獨立種子 stream('level.enemies.main')，與 level.main 分流
 * （不共用同一個 rng 實例，避免敵人配置的增修影響關卡幾何的既有生成序列）。
 */
function generateCrawlerSpawnPositions(floorY: number): Vec3[] {
  const rng = stream("level.enemies.main");
  const positions: Vec3[] = [];
  for (let i = 0; i < CRAWLER_SPAWN_COUNT; i++) {
    const angle = (i / CRAWLER_SPAWN_COUNT) * Math.PI * 2 + rng() * 0.6;
    const radius = CRAWLER_SPAWN_RADIUS_MIN + rng() * (CRAWLER_SPAWN_RADIUS_MAX - CRAWLER_SPAWN_RADIUS_MIN);
    positions.push({ x: Math.cos(angle) * radius, y: floorY, z: Math.sin(angle) * radius });
  }
  return positions;
}

/**
 * 產生 M0/M1 測試房：地板、四面牆、隨機障礙箱，回傳幾何與碰撞資料與 levelHash。
 * 地板與牆面（含障礙箱，視覺上同屬「石材結構」）分別烘進兩份獨立頂點／索引陣列，
 * 供 renderer 各自綁定 texture.floor_planks／texture.stone_wall（PLAN §5.1 藝術方向修訂）。
 */
export function generateTestRoom(): RoomGeometry {
  const rng = stream("level.main");

  const floorTarget: BoxBuildResult = { vertices: [], indices: [] };
  const wallTarget: BoxBuildResult = { vertices: [], indices: [] };
  const ceilingTarget: BoxBuildResult = { vertices: [], indices: [] };
  const colliders: Aabb[] = [];

  // 地板：頂面在 y = 0
  const floorSpec: ObstacleSpec = {
    center: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
    half: { x: ROOM_HALF_WIDTH, y: FLOOR_THICKNESS / 2, z: ROOM_HALF_DEPTH },
  };
  appendBox(floorTarget, floorSpec.center, floorSpec.half);
  colliders.push(aabbFromCenterHalf(floorSpec.center, floorSpec.half));

  // 天花板：與地板同腳印，置於牆頂（y=WALL_HEIGHT）；純視覺補上開放式測試房的上方虛空，
  // 不加入 colliders（玩家跳躍高度僅 1.2m，構造上不可能觸及）。固定常數、非 rng 生成，
  // 不影響 levelHash 的決定性驗證範圍（見下方 computeLevelHash 呼叫處註解）。
  const ceilingSpec: ObstacleSpec = {
    center: { x: 0, y: WALL_HEIGHT + FLOOR_THICKNESS / 2, z: 0 },
    half: { x: ROOM_HALF_WIDTH, y: FLOOR_THICKNESS / 2, z: ROOM_HALF_DEPTH },
  };
  appendBox(ceilingTarget, ceilingSpec.center, ceilingSpec.half);

  // 四面牆（沿房間邊界，高 4m，內壁貼齊 ±10m）
  const wallSpecs: ObstacleSpec[] = [
    {
      // +X 牆
      center: { x: ROOM_HALF_WIDTH + WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: 0 },
      half: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: ROOM_HALF_DEPTH + WALL_THICKNESS },
    },
    {
      // -X 牆
      center: { x: -(ROOM_HALF_WIDTH + WALL_THICKNESS / 2), y: WALL_HEIGHT / 2, z: 0 },
      half: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: ROOM_HALF_DEPTH + WALL_THICKNESS },
    },
    {
      // +Z 牆
      center: { x: 0, y: WALL_HEIGHT / 2, z: ROOM_HALF_DEPTH + WALL_THICKNESS / 2 },
      half: { x: ROOM_HALF_WIDTH + WALL_THICKNESS, y: WALL_HEIGHT / 2, z: WALL_THICKNESS / 2 },
    },
    {
      // -Z 牆
      center: { x: 0, y: WALL_HEIGHT / 2, z: -(ROOM_HALF_DEPTH + WALL_THICKNESS / 2) },
      half: { x: ROOM_HALF_WIDTH + WALL_THICKNESS, y: WALL_HEIGHT / 2, z: WALL_THICKNESS / 2 },
    },
  ];
  for (const wall of wallSpecs) {
    appendBox(wallTarget, wall.center, wall.half);
    colliders.push(aabbFromCenterHalf(wall.center, wall.half));
  }

  // 障礙箱：位置與尺寸由 stream('level.main') 決定；視覺上併入牆面（石材）材質群組
  const obstacles = generateObstacles(rng);
  for (const obstacle of obstacles) {
    appendBox(wallTarget, obstacle.center, obstacle.half);
    colliders.push(aabbFromCenterHalf(obstacle.center, obstacle.half));
  }

  // 敵人配置：3 隻巡行體，位置由 stream('level.enemies.main') 決定（純 CPU 決定性）
  const enemySpawns = generateCrawlerSpawnPositions(0);

  // levelHash 刻意不涵蓋天花板：PLAN §6.4 決定性鐵則要求逐位元一致驗證的對象是「影響玩法的
  // 生成」（關卡佈局、碰撞、敵人與物品位置、數值）；天花板是固定常數、不經任何 rng stream
  // 生成、不參與碰撞，純外觀補件，與 floorSpec/wallSpecs/obstacles/enemySpawns 的性質不同，
  // 納入雜湊不會增加任何決定性驗證力（本就恆為常數），故維持雜湊輸入不變。
  const levelHash = computeLevelHash(floorSpec, wallSpecs, obstacles, enemySpawns);

  return {
    floorVertices: new Float32Array(floorTarget.vertices),
    floorIndices: new Uint32Array(floorTarget.indices),
    wallVertices: new Float32Array(wallTarget.vertices),
    wallIndices: new Uint32Array(wallTarget.indices),
    ceilingVertices: new Float32Array(ceilingTarget.vertices),
    ceilingIndices: new Uint32Array(ceilingTarget.indices),
    colliders,
    floorY: 0,
    levelHash,
    enemySpawns,
  };
}
