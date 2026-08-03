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
  vertices: Float32Array;
  indices: Uint32Array;
  colliders: Aabb[];
  floorY: number;
  levelHash: string;
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

function computeLevelHash(floorSpec: ObstacleSpec, wallSpecs: ObstacleSpec[], obstacles: ObstacleSpec[]): string {
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

  const serialized = parts.join(",");
  const hash = fnv1a(serialized);
  return hash.toString(16).padStart(8, "0");
}

/** 產生 M0 測試房：地板、四面牆、隨機障礙箱，回傳幾何與碰撞資料與 levelHash。 */
export function generateTestRoom(): RoomGeometry {
  const rng = stream("level.main");

  const target: BoxBuildResult = { vertices: [], indices: [] };
  const colliders: Aabb[] = [];

  // 地板：頂面在 y = 0
  const floorSpec: ObstacleSpec = {
    center: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
    half: { x: ROOM_HALF_WIDTH, y: FLOOR_THICKNESS / 2, z: ROOM_HALF_DEPTH },
  };
  appendBox(target, floorSpec.center, floorSpec.half);
  colliders.push(aabbFromCenterHalf(floorSpec.center, floorSpec.half));

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
    appendBox(target, wall.center, wall.half);
    colliders.push(aabbFromCenterHalf(wall.center, wall.half));
  }

  // 障礙箱：位置與尺寸由 stream('level.main') 決定
  const obstacles = generateObstacles(rng);
  for (const obstacle of obstacles) {
    appendBox(target, obstacle.center, obstacle.half);
    colliders.push(aabbFromCenterHalf(obstacle.center, obstacle.half));
  }

  const levelHash = computeLevelHash(floorSpec, wallSpecs, obstacles);

  return {
    vertices: new Float32Array(target.vertices),
    indices: new Uint32Array(target.indices),
    colliders,
    floorY: 0,
    levelHash,
  };
}
