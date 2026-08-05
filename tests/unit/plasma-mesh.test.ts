// node:test 純邏輯單元測試：電漿步槍 viewmodel 網格的決定性、非空、頂點可整除、能源青發光條存在。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePlasmaRifleMesh, PLASMA_RIFLE_VERTEX_STRIDE } from "../../src/procgen/mesh/plasma-rifle.ts";

test("generatePlasmaRifleMesh 兩次生成的頂點與索引逐位元相同（同 seed 決定性）", () => {
  const a = generatePlasmaRifleMesh();
  const b = generatePlasmaRifleMesh();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
  assert.deepEqual(a.muzzleLocal, b.muzzleLocal);
});

test("generatePlasmaRifleMesh 產出非空幾何", () => {
  const mesh = generatePlasmaRifleMesh();
  assert.ok(mesh.vertices.length > 0);
  assert.ok(mesh.indices.length > 0);
});

test("頂點數量可被 stride 整除，且每面 4 頂點 6 面故可被 24 整除", () => {
  const mesh = generatePlasmaRifleMesh();
  assert.equal(mesh.vertices.length % PLASMA_RIFLE_VERTEX_STRIDE, 0);
  const vertexCount = mesh.vertices.length / PLASMA_RIFLE_VERTEX_STRIDE;
  assert.equal(vertexCount % 24, 0);
});

test("索引值皆落在頂點數量範圍內（無越界索引）", () => {
  const mesh = generatePlasmaRifleMesh();
  const vertexCount = mesh.vertices.length / PLASMA_RIFLE_VERTEX_STRIDE;
  for (const idx of mesh.indices) {
    assert.ok(idx >= 0 && idx < vertexCount, `索引 ${idx} 越界（頂點數 ${vertexCount}）`);
  }
});

test("含至少一個能源青（#35E0FF）頂點色（發光條）", () => {
  const mesh = generatePlasmaRifleMesh();
  let found = false;
  for (let i = 0; i < mesh.vertices.length; i += PLASMA_RIFLE_VERTEX_STRIDE) {
    const r = mesh.vertices[i + 6];
    const g = mesh.vertices[i + 7];
    const b = mesh.vertices[i + 8];
    if (Math.abs(r - 0x35 / 255) < 0.01 && Math.abs(g - 0xe0 / 255) < 0.01 && Math.abs(b - 0xff / 255) < 0.01) {
      found = true;
      break;
    }
  }
  assert.ok(found, "應至少有一個能源青頂點色（發光條）");
});

test("比散射槍長：槍身＋槍管的最大 |z| 延伸應大於散射槍（本次派工規格）", async () => {
  const { generateShotgunMesh, SHOTGUN_VERTEX_STRIDE } = await import("../../src/procgen/mesh/shotgun.ts");
  const plasmaMesh = generatePlasmaRifleMesh();
  const shotgunMesh = generateShotgunMesh();

  function maxAbsZ(vertices: Float32Array, stride: number): number {
    let maxZ = 0;
    for (let i = 0; i < vertices.length; i += stride) {
      const z = Math.abs(vertices[i + 2]);
      if (z > maxZ) maxZ = z;
    }
    return maxZ;
  }
  const plasmaLength = maxAbsZ(plasmaMesh.vertices, PLASMA_RIFLE_VERTEX_STRIDE);
  const shotgunLength = maxAbsZ(shotgunMesh.vertices, SHOTGUN_VERTEX_STRIDE);
  assert.ok(plasmaLength > shotgunLength, `電漿步槍長度 ${plasmaLength.toFixed(3)} 應大於散射槍 ${shotgunLength.toFixed(3)}`);
});
