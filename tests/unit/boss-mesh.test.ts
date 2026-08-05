// node:test 純邏輯單元測試：首領核心守護者程序化模型的決定性、非空、站立高度、命中包絡不變量、
// 弱點面存在、剪影與其餘三種敵人明顯可分（更寬更高）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBossMesh, BOSS_VERTEX_STRIDE } from "../../src/procgen/mesh/boss.ts";
import { BOSS_HALF } from "../../src/game/boss.ts";
import { AIM_ASSIST_MARGIN } from "../../src/game/weapons.ts";

test("generateBossMesh 兩次生成的頂點與索引逐位元相同（同 seed 決定性）", () => {
  const a = generateBossMesh();
  const b = generateBossMesh();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
});

test("generateBossMesh 產出非空幾何", () => {
  const mesh = generateBossMesh();
  assert.ok(mesh.vertices.length > 0);
  assert.ok(mesh.indices.length > 0);
});

test("頂點數量可被 stride 整除，且每面 4 頂點 6 面故可被 24 整除", () => {
  const mesh = generateBossMesh();
  assert.equal(mesh.vertices.length % BOSS_VERTEX_STRIDE, 0);
  const vertexCount = mesh.vertices.length / BOSS_VERTEX_STRIDE;
  assert.equal(vertexCount % 24, 0);
});

test("索引值皆落在頂點數量範圍內（無越界索引）", () => {
  const mesh = generateBossMesh();
  const vertexCount = mesh.vertices.length / BOSS_VERTEX_STRIDE;
  for (const idx of mesh.indices) {
    assert.ok(idx >= 0 && idx < vertexCount, `索引 ${idx} 越界（頂點數 ${vertexCount}）`);
  }
});

test("站立總高鎖定約 3.0±0.3m（本次派工規格：明顯大於一切敵人）", () => {
  const mesh = generateBossMesh();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.vertices.length; i += BOSS_VERTEX_STRIDE) {
    const y = mesh.vertices[i + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  assert.ok(Math.abs(height - 3.0) <= 0.3, `站立高度應為 3.0±0.3m，實際 ${height}`);
});

test("視覺不超出命中包絡：任何頂點的水平半徑 ≤ min(BOSS_HALF.x, z) + AIM_ASSIST_MARGIN（含安全餘量）", () => {
  const mesh = generateBossMesh();
  const limit = Math.min(BOSS_HALF.x, BOSS_HALF.z) + AIM_ASSIST_MARGIN - 0.005;
  let maxRadius = 0;
  for (let i = 0; i < mesh.vertices.length; i += BOSS_VERTEX_STRIDE) {
    const x = mesh.vertices[i];
    const z = mesh.vertices[i + 2];
    const r = Math.hypot(x, z);
    if (r > maxRadius) maxRadius = r;
  }
  assert.ok(maxRadius <= limit, `最大水平半徑 ${maxRadius.toFixed(3)} 超出命中包絡上限 ${limit.toFixed(3)}`);
});

function colorAt(vertices: Float32Array, i: number): [number, number, number] {
  return [vertices[i + 6], vertices[i + 7], vertices[i + 8]];
}

function isWarningColor(r: number, g: number, b: number): boolean {
  return Math.abs(r - 0xff / 255) < 0.01 && Math.abs(g - 0x5a / 255) < 0.01 && Math.abs(b - 0x26 / 255) < 0.01;
}

test("含至少一個警示橘頂點色（核心弱點面，本次派工規格）", () => {
  const mesh = generateBossMesh();
  let found = false;
  for (let i = 0; i < mesh.vertices.length; i += BOSS_VERTEX_STRIDE) {
    const [r, g, b] = colorAt(mesh.vertices, i);
    if (isWarningColor(r, g, b)) {
      found = true;
      break;
    }
  }
  assert.ok(found, "應至少有一個警示橘頂點色");
});

test("含至少一個能源青（#35E0FF）頂點色（發光環帶）", () => {
  const mesh = generateBossMesh();
  let found = false;
  for (let i = 0; i < mesh.vertices.length; i += BOSS_VERTEX_STRIDE) {
    const [r, g, b] = colorAt(mesh.vertices, i);
    if (Math.abs(r - 0x35 / 255) < 0.01 && Math.abs(g - 0xe0 / 255) < 0.01 && Math.abs(b - 0xff / 255) < 0.01) {
      found = true;
      break;
    }
  }
  assert.ok(found, "應至少有一個能源青頂點色");
});

test("剪影獨一無二：首領站立高度與水平最大半徑皆明顯大於巡行體、射擊體、守衛體", async () => {
  const { generateCrawlerMesh, CRAWLER_VERTEX_STRIDE } = await import("../../src/procgen/mesh/crawler.ts");
  const { generateSpitterMesh, SPITTER_VERTEX_STRIDE } = await import("../../src/procgen/mesh/spitter.ts");
  const { generateWardenMesh, WARDEN_VERTEX_STRIDE } = await import("../../src/procgen/mesh/warden.ts");

  function extent(vertices: Float32Array, stride: number): { height: number; radius: number } {
    let minY = Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    for (let i = 0; i < vertices.length; i += stride) {
      const x = vertices[i];
      const y = vertices[i + 1];
      const z = vertices[i + 2];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const r = Math.hypot(x, z);
      if (r > maxR) maxR = r;
    }
    return { height: maxY - minY, radius: maxR };
  }

  const boss = extent(generateBossMesh().vertices, BOSS_VERTEX_STRIDE);
  const crawler = extent(generateCrawlerMesh().vertices, CRAWLER_VERTEX_STRIDE);
  const spitter = extent(generateSpitterMesh().vertices, SPITTER_VERTEX_STRIDE);
  const warden = extent(generateWardenMesh().vertices, WARDEN_VERTEX_STRIDE);

  for (const [name, other] of [
    ["crawler", crawler],
    ["spitter", spitter],
    ["warden", warden],
  ] as const) {
    assert.ok(boss.height > other.height + 0.5, `首領高度 ${boss.height.toFixed(2)} 應明顯大於 ${name} ${other.height.toFixed(2)}`);
    assert.ok(boss.radius > other.radius + 0.3, `首領水平半徑 ${boss.radius.toFixed(2)} 應明顯大於 ${name} ${other.radius.toFixed(2)}`);
  }
});
