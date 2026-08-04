// node:test 純邏輯單元測試：巡行體程序化模型的決定性（同 seed 兩次生成逐位元相同）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCrawlerMesh, CRAWLER_VERTEX_STRIDE } from "../../src/procgen/mesh/crawler.ts";

test("generateCrawlerMesh 兩次生成的頂點與索引逐位元相同（同 seed 決定性）", () => {
  const a = generateCrawlerMesh();
  const b = generateCrawlerMesh();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
});

test("generateCrawlerMesh 產出非空幾何（有值不等於有效：至少要有頂點與索引）", () => {
  const mesh = generateCrawlerMesh();
  assert.ok(mesh.vertices.length > 0, "頂點陣列不可為空");
  assert.ok(mesh.indices.length > 0, "索引陣列不可為空");
});

test("頂點數量可被 stride 整除，且每面 4 頂點 6 面故可被 24 整除（沿用 room.ts 立方體慣例）", () => {
  const mesh = generateCrawlerMesh();
  assert.equal(mesh.vertices.length % CRAWLER_VERTEX_STRIDE, 0);
  const vertexCount = mesh.vertices.length / CRAWLER_VERTEX_STRIDE;
  assert.equal(vertexCount % 24, 0);
});

test("索引值皆落在頂點數量範圍內（無越界索引）", () => {
  const mesh = generateCrawlerMesh();
  const vertexCount = mesh.vertices.length / CRAWLER_VERTEX_STRIDE;
  for (const idx of mesh.indices) {
    assert.ok(idx >= 0 && idx < vertexCount, `索引 ${idx} 越界（頂點數 ${vertexCount}）`);
  }
});

test("含至少一個警示橘（#FF5A26）頂點色（頭部或胸口警示點）", () => {
  const mesh = generateCrawlerMesh();
  let foundWarning = false;
  for (let i = 0; i < mesh.vertices.length; i += CRAWLER_VERTEX_STRIDE) {
    const r = mesh.vertices[i + 6];
    const g = mesh.vertices[i + 7];
    const b = mesh.vertices[i + 8];
    if (Math.abs(r - 0xff / 255) < 0.01 && Math.abs(g - 0x5a / 255) < 0.01 && Math.abs(b - 0x26 / 255) < 0.01) {
      foundWarning = true;
      break;
    }
  }
  assert.ok(foundWarning, "應至少有一個警示橘頂點色（PLAN §5.1 #FF5A26）");
});

test("站立總高鎖定在 1.7±0.1m（PLAN §3.4 v4 殭屍人形，頂點 y 範圍即站姿高度）", () => {
  const mesh = generateCrawlerMesh();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.vertices.length; i += CRAWLER_VERTEX_STRIDE) {
    const y = mesh.vertices[i + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  assert.ok(Math.abs(height - 1.7) <= 0.1, `站立高度應為 1.7±0.1m，實際 ${height}`);
});
