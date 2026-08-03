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

test("generateTestRoom 兩次生成的頂點與索引陣列逐位元相同", () => {
  const a = generateTestRoom();
  const b = generateTestRoom();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
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

test("頂點數量為 24 的倍數（每個立方體 6 面 x 4 頂點），且可被 stride 整除", () => {
  const room = generateTestRoom();
  const vertexCount = room.vertices.length / VERTEX_STRIDE;
  assert.equal(vertexCount % 24, 0);
  assert.equal(room.vertices.length % VERTEX_STRIDE, 0);
});

test("floorY 固定為 0（地面高度基準）", () => {
  const room = generateTestRoom();
  assert.equal(room.floorY, 0);
});
