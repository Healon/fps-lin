// node:test 純邏輯單元測試：能源核心視覺結構（procgen/mesh/energy-core.ts）的決定性、非空、
// 頂點可整除、高度貼近區域 F 挑高、含能源青發光環帶。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateEnergyCoreMesh, ENERGY_CORE_VERTEX_STRIDE } from "../../src/procgen/mesh/energy-core.ts";

test("generateEnergyCoreMesh 兩次生成的頂點與索引逐位元相同（同 seed 決定性）", () => {
  const a = generateEnergyCoreMesh();
  const b = generateEnergyCoreMesh();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
});

test("generateEnergyCoreMesh 產出非空幾何", () => {
  const mesh = generateEnergyCoreMesh();
  assert.ok(mesh.vertices.length > 0);
  assert.ok(mesh.indices.length > 0);
});

test("頂點數量可被 stride 整除，且每面 4 頂點 6 面故可被 24 整除", () => {
  const mesh = generateEnergyCoreMesh();
  assert.equal(mesh.vertices.length % ENERGY_CORE_VERTEX_STRIDE, 0);
  const vertexCount = mesh.vertices.length / ENERGY_CORE_VERTEX_STRIDE;
  assert.equal(vertexCount % 24, 0);
});

test("索引值皆落在頂點數量範圍內（無越界索引）", () => {
  const mesh = generateEnergyCoreMesh();
  const vertexCount = mesh.vertices.length / ENERGY_CORE_VERTEX_STRIDE;
  for (const idx of mesh.indices) {
    assert.ok(idx >= 0 && idx < vertexCount, `索引 ${idx} 越界（頂點數 ${vertexCount}）`);
  }
});

test("高聳柱體：站立總高應貼近區域 F 挑高（9m），且明顯高於任何敵人剪影（>5m）", () => {
  const mesh = generateEnergyCoreMesh();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.vertices.length; i += ENERGY_CORE_VERTEX_STRIDE) {
    const y = mesh.vertices[i + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  assert.ok(height > 5, `柱體高度應明顯高聳（>5m），實際 ${height}`);
  assert.ok(height <= 9, `柱體高度不應超出區域 F 挑高 9m，實際 ${height}`);
});

test("含至少一個能源青（#35E0FF）頂點色（發光環帶），且不只一圈（多道環帶）", () => {
  const mesh = generateEnergyCoreMesh();
  const glowYs = new Set<number>();
  for (let i = 0; i < mesh.vertices.length; i += ENERGY_CORE_VERTEX_STRIDE) {
    const r = mesh.vertices[i + 6];
    const g = mesh.vertices[i + 7];
    const b = mesh.vertices[i + 8];
    if (Math.abs(r - 0x35 / 255) < 0.01 && Math.abs(g - 0xe0 / 255) < 0.01 && Math.abs(b - 0xff / 255) < 0.01) {
      glowYs.add(Math.round(mesh.vertices[i + 1] * 100));
    }
  }
  assert.ok(glowYs.size >= 3, `應至少有三道不同高度的能源青發光環帶，實際偵測到 ${glowYs.size} 種高度`);
});
