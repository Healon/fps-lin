// node:test 純邏輯單元測試：能量砲 viewmodel 網格的決定性、非空、頂點可整除、三級充能發光色、
// 比電漿步槍粗壯厚重。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCannonMesh, CANNON_VERTEX_STRIDE } from "../../src/procgen/mesh/cannon.ts";

test("generateCannonMesh 同 tier 兩次生成的頂點與索引逐位元相同（同 seed 決定性）", () => {
  const a = generateCannonMesh(0);
  const b = generateCannonMesh(0);
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
  assert.deepEqual(a.muzzleLocal, b.muzzleLocal);
});

test("generateCannonMesh 產出非空幾何", () => {
  const mesh = generateCannonMesh(1);
  assert.ok(mesh.vertices.length > 0);
  assert.ok(mesh.indices.length > 0);
});

test("頂點數量可被 stride 整除，且每面 4 頂點 6 面故可被 24 整除", () => {
  const mesh = generateCannonMesh(2);
  assert.equal(mesh.vertices.length % CANNON_VERTEX_STRIDE, 0);
  const vertexCount = mesh.vertices.length / CANNON_VERTEX_STRIDE;
  assert.equal(vertexCount % 24, 0);
});

test("索引值皆落在頂點數量範圍內（無越界索引）", () => {
  const mesh = generateCannonMesh(0);
  const vertexCount = mesh.vertices.length / CANNON_VERTEX_STRIDE;
  for (const idx of mesh.indices) {
    assert.ok(idx >= 0 && idx < vertexCount, `索引 ${idx} 越界（頂點數 ${vertexCount}）`);
  }
});

function collectColors(vertices: Float32Array): [number, number, number][] {
  const colors: [number, number, number][] = [];
  for (let i = 0; i < vertices.length; i += CANNON_VERTEX_STRIDE) {
    colors.push([vertices[i + 6], vertices[i + 7], vertices[i + 8]]);
  }
  return colors;
}

test("三級充能發光色：tier 0／1／2 的發光條頂點色皆不同，且亮度隨 tier 遞增", () => {
  const tier0 = collectColors(generateCannonMesh(0).vertices);
  const tier1 = collectColors(generateCannonMesh(1).vertices);
  const tier2 = collectColors(generateCannonMesh(2).vertices);

  // 幾何結構相同（同一組 seed 呼叫），故三者頂點數相同，僅發光色頂點的 RGB 值不同。
  assert.equal(tier0.length, tier1.length);
  assert.equal(tier1.length, tier2.length);

  let diffFound01 = false;
  let diffFound12 = false;
  for (let i = 0; i < tier0.length; i++) {
    if (tier0[i].some((v, j) => Math.abs(v - tier1[i][j]) > 1e-6)) diffFound01 = true;
    if (tier1[i].some((v, j) => Math.abs(v - tier2[i][j]) > 1e-6)) diffFound12 = true;
  }
  assert.ok(diffFound01, "tier 0 與 tier 1 應有頂點色差異");
  assert.ok(diffFound12, "tier 1 與 tier 2 應有頂點色差異");

  // 亮度（RGB 總和）應隨 tier 遞增：找出每個 tier 中最亮的頂點色比較。
  const brightest = (colors: [number, number, number][]): number => Math.max(...colors.map(([r, g, b]) => r + g + b));
  assert.ok(brightest(tier1) > brightest(tier0), "tier1 最亮頂點應比 tier0 更亮");
  assert.ok(brightest(tier2) > brightest(tier1), "tier2 最亮頂點應比 tier1 更亮");
});

test("粗壯厚重：能量砲槍身寬高應大於電漿步槍（本次派工規格）", async () => {
  const { generatePlasmaRifleMesh, PLASMA_RIFLE_VERTEX_STRIDE } = await import("../../src/procgen/mesh/plasma-rifle.ts");
  const cannonMesh = generateCannonMesh(0);
  const plasmaMesh = generatePlasmaRifleMesh();

  function maxAbsXY(vertices: Float32Array, stride: number): { x: number; y: number } {
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < vertices.length; i += stride) {
      maxX = Math.max(maxX, Math.abs(vertices[i]));
      maxY = Math.max(maxY, Math.abs(vertices[i + 1]));
    }
    return { x: maxX, y: maxY };
  }
  const cannonExtent = maxAbsXY(cannonMesh.vertices, CANNON_VERTEX_STRIDE);
  const plasmaExtent = maxAbsXY(plasmaMesh.vertices, PLASMA_RIFLE_VERTEX_STRIDE);
  assert.ok(cannonExtent.x > plasmaExtent.x, `能量砲寬度 ${cannonExtent.x.toFixed(3)} 應大於電漿步槍 ${plasmaExtent.x.toFixed(3)}`);
  assert.ok(cannonExtent.y > plasmaExtent.y, `能量砲高度 ${cannonExtent.y.toFixed(3)} 應大於電漿步槍 ${plasmaExtent.y.toFixed(3)}`);
});
