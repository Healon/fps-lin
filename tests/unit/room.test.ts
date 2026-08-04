// node:test 純邏輯單元測試：驗證關卡生成的決定性（同 seed 兩次結果全等）與基本結構正確性。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateTestRoom, VERTEX_STRIDE } from "../../src/procgen/level/room.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(here, "..", "golden", "level-hash.txt");

test("generateTestRoom 兩次生成的 levelHash 完全一致（跨次決定性）", () => {
  const a = generateTestRoom();
  const b = generateTestRoom();
  assert.equal(a.levelHash, b.levelHash);
});

test("generateTestRoom 兩次生成的地板與牆面頂點／索引陣列逐位元相同", () => {
  const a = generateTestRoom();
  const b = generateTestRoom();
  assert.deepEqual(Array.from(a.floorVertices), Array.from(b.floorVertices));
  assert.deepEqual(Array.from(a.floorIndices), Array.from(b.floorIndices));
  assert.deepEqual(Array.from(a.wallVertices), Array.from(b.wallVertices));
  assert.deepEqual(Array.from(a.wallIndices), Array.from(b.wallIndices));
});

test("levelHash 為 8 位小寫十六進位字串，且與 golden 檔一致", () => {
  const room = generateTestRoom();
  assert.match(room.levelHash, /^[0-9a-f]{8}$/);
  const golden = readFileSync(goldenPath, "utf8").trim();
  assert.equal(room.levelHash, golden);
});

test("障礙箱數量落在 3 至 5 間（含），加地板與四面牆共 8 至 10 個碰撞體", () => {
  const room = generateTestRoom();
  assert.ok(room.colliders.length >= 8 && room.colliders.length <= 10, `colliders.length=${room.colliders.length}`);
});

test("地板與牆面頂點數量皆為 24 的倍數（每個立方體 6 面 x 4 頂點），且可被 stride 整除", () => {
  const room = generateTestRoom();
  const floorVertexCount = room.floorVertices.length / VERTEX_STRIDE;
  assert.equal(floorVertexCount % 24, 0);
  assert.equal(room.floorVertices.length % VERTEX_STRIDE, 0);

  const wallVertexCount = room.wallVertices.length / VERTEX_STRIDE;
  assert.equal(wallVertexCount % 24, 0);
  assert.equal(room.wallVertices.length % VERTEX_STRIDE, 0);
});

test("floorY 固定為 0（地面高度基準）", () => {
  const room = generateTestRoom();
  assert.equal(room.floorY, 0);
});

test("enemySpawns：固定 3 隻巡行體，位置落於房間邊界內，且 y 對齊 floorY", () => {
  const room = generateTestRoom();
  assert.equal(room.enemySpawns.length, 3);
  for (const spawn of room.enemySpawns) {
    assert.equal(spawn.y, room.floorY);
    assert.ok(Math.abs(spawn.x) < 10, `x=${spawn.x} 應在房間邊界內`);
    assert.ok(Math.abs(spawn.z) < 10, `z=${spawn.z} 應在房間邊界內`);
  }
});

test("enemySpawns：兩次生成逐位元相同（與 level.main 分流的獨立決定性種子）", () => {
  const a = generateTestRoom();
  const b = generateTestRoom();
  assert.deepEqual(a.enemySpawns, b.enemySpawns);
});
