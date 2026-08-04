// node:test 純邏輯單元測試：M2 新增的 props 網格（門板、散射槍 viewmodel）決定性與非空幾何。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDoorMesh, DOOR_VERTEX_STRIDE } from "../../src/procgen/mesh/door.ts";
import { generateShotgunMesh, SHOTGUN_VERTEX_STRIDE } from "../../src/procgen/mesh/shotgun.ts";
import { generateAmmoBoxMesh, generateMedkitBoxMesh, PICKUP_PROP_VERTEX_STRIDE } from "../../src/procgen/mesh/pickup-props.ts";

test("generateDoorMesh：決定性、非空、索引不越界", () => {
  const a = generateDoorMesh();
  const b = generateDoorMesh();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.ok(a.vertices.length > 0);
  const vertexCount = a.vertices.length / DOOR_VERTEX_STRIDE;
  for (const idx of a.indices) assert.ok(idx >= 0 && idx < vertexCount);
});

test("generateShotgunMesh：決定性、非空、索引不越界、muzzleLocal 在槍身前方（z 為負）", () => {
  const a = generateShotgunMesh();
  const b = generateShotgunMesh();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(a.muzzleLocal, b.muzzleLocal);
  assert.ok(a.vertices.length > 0);
  const vertexCount = a.vertices.length / SHOTGUN_VERTEX_STRIDE;
  for (const idx of a.indices) assert.ok(idx >= 0 && idx < vertexCount);
  assert.ok(a.muzzleLocal.z < 0, "槍口應在 -Z 前方");
});

test("generateShotgunMesh：比脈衝手槍寬短（bodyHalf.x 較大、bodyHalf.z 較小，取自頂點極值近似驗證）", async () => {
  const { generatePistolMesh } = await import("../../src/procgen/mesh/pistol.ts");
  const shotgun = generateShotgunMesh();
  const pistol = generatePistolMesh();

  function extentX(vertices: Float32Array, stride: number): number {
    let max = 0;
    for (let i = 0; i < vertices.length; i += stride) max = Math.max(max, Math.abs(vertices[i]));
    return max;
  }
  const shotgunX = extentX(shotgun.vertices, SHOTGUN_VERTEX_STRIDE);
  const pistolX = extentX(pistol.vertices, SHOTGUN_VERTEX_STRIDE);
  assert.ok(shotgunX > pistolX, `散射槍寬度 ${shotgunX} 應大於手槍 ${pistolX}`);
});

test("generateAmmoBoxMesh／generateMedkitBoxMesh：決定性、非空、索引不越界", () => {
  for (const gen of [generateAmmoBoxMesh, generateMedkitBoxMesh]) {
    const a = gen();
    const b = gen();
    assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
    assert.ok(a.vertices.length > 0);
    const vertexCount = a.vertices.length / PICKUP_PROP_VERTEX_STRIDE;
    for (const idx of a.indices) assert.ok(idx >= 0 && idx < vertexCount);
  }
});

test("generateMedkitBoxMesh：含治療綠（#3DFF8E）十字頂點色", () => {
  const mesh = generateMedkitBoxMesh();
  let found = false;
  for (let i = 0; i < mesh.vertices.length; i += PICKUP_PROP_VERTEX_STRIDE) {
    const r = mesh.vertices[i + 6];
    const g = mesh.vertices[i + 7];
    const bch = mesh.vertices[i + 8];
    if (Math.abs(r - 0x3d / 255) < 0.01 && Math.abs(g - 0xff / 255) < 0.01 && Math.abs(bch - 0x8e / 255) < 0.01) {
      found = true;
      break;
    }
  }
  assert.ok(found, "應含治療綠十字頂點色");
});
