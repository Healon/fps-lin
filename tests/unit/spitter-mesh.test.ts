// node:test 純邏輯單元測試：射擊體程序化模型的決定性、非空、站立高度、警示橘、命中包絡不變量。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSpitterMesh, SPITTER_VERTEX_STRIDE } from "../../src/procgen/mesh/spitter.ts";
import { SPITTER_HALF } from "../../src/game/spitter.ts";
import { AIM_ASSIST_MARGIN } from "../../src/game/weapons.ts";

test("generateSpitterMesh 兩次生成的頂點與索引逐位元相同（同 seed 決定性）", () => {
  const a = generateSpitterMesh();
  const b = generateSpitterMesh();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
  assert.deepEqual(a.muzzleLocal, b.muzzleLocal);
});

test("generateSpitterMesh 產出非空幾何（有值不等於有效：至少要有頂點與索引）", () => {
  const mesh = generateSpitterMesh();
  assert.ok(mesh.vertices.length > 0, "頂點陣列不可為空");
  assert.ok(mesh.indices.length > 0, "索引陣列不可為空");
});

test("頂點數量可被 stride 整除，且每面 4 頂點 6 面故可被 24 整除", () => {
  const mesh = generateSpitterMesh();
  assert.equal(mesh.vertices.length % SPITTER_VERTEX_STRIDE, 0);
  const vertexCount = mesh.vertices.length / SPITTER_VERTEX_STRIDE;
  assert.equal(vertexCount % 24, 0);
});

test("索引值皆落在頂點數量範圍內（無越界索引）", () => {
  const mesh = generateSpitterMesh();
  const vertexCount = mesh.vertices.length / SPITTER_VERTEX_STRIDE;
  for (const idx of mesh.indices) {
    assert.ok(idx >= 0 && idx < vertexCount, `索引 ${idx} 越界（頂點數 ${vertexCount}）`);
  }
});

test("含至少一個警示橘（#FF5A26）頂點色（頭部發光砲口）", () => {
  const mesh = generateSpitterMesh();
  let foundWarning = false;
  for (let i = 0; i < mesh.vertices.length; i += SPITTER_VERTEX_STRIDE) {
    const r = mesh.vertices[i + 6];
    const g = mesh.vertices[i + 7];
    const b = mesh.vertices[i + 8];
    if (Math.abs(r - 0xff / 255) < 0.01 && Math.abs(g - 0x5a / 255) < 0.01 && Math.abs(b - 0x26 / 255) < 0.01) {
      foundWarning = true;
      break;
    }
  }
  assert.ok(foundWarning, "應至少有一個警示橘頂點色（PLAN §5.1 #FF5A26，頭部砲口）");
});

test("站立總高鎖定在 1.9±0.1m（PLAN §3.4：較巡行體高瘦）", () => {
  const mesh = generateSpitterMesh();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.vertices.length; i += SPITTER_VERTEX_STRIDE) {
    const y = mesh.vertices[i + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  assert.ok(Math.abs(height - 1.9) <= 0.1, `站立高度應為 1.9±0.1m，實際 ${height}`);
});

test("視覺不超出命中包絡：任何頂點的水平半徑 ≤ min(SPITTER_HALF.x, z) + AIM_ASSIST_MARGIN（含安全餘量）", () => {
  const mesh = generateSpitterMesh();
  const limit = Math.min(SPITTER_HALF.x, SPITTER_HALF.z) + AIM_ASSIST_MARGIN - 0.005;
  let maxRadius = 0;
  for (let i = 0; i < mesh.vertices.length; i += SPITTER_VERTEX_STRIDE) {
    const x = mesh.vertices[i];
    const z = mesh.vertices[i + 2];
    const r = Math.hypot(x, z);
    if (r > maxRadius) maxRadius = r;
  }
  assert.ok(maxRadius <= limit, `最大水平半徑 ${maxRadius.toFixed(3)} 超出命中包絡上限 ${limit.toFixed(3)}`);
});

test("剪影與巡行體明顯不同：射擊體水平最大半徑（瘦長三足）應明顯小於巡行體（含前伸雙臂）", async () => {
  // 純高度差不夠穩健（兩者皆有 rng 微調區間，數值上可能相近，見 1.9±0.1 與 1.7±0.1 兩區間
  // 在邊界處會重疊）。改用水平剪影寬度：射擊體三足收攏於中軸附近，巡行體雙臂前伸展開，
  // 這是兩者「一眼可分」的真正幾何依據（瘦長 vs 寬壯），比高度更能反映實際剪影差異。
  const { generateCrawlerMesh, CRAWLER_VERTEX_STRIDE } = await import("../../src/procgen/mesh/crawler.ts");
  const spitterMesh = generateSpitterMesh();
  const crawlerMesh = generateCrawlerMesh();

  function maxHorizontalRadius(vertices: Float32Array, stride: number): number {
    let maxR = 0;
    for (let i = 0; i < vertices.length; i += stride) {
      const x = vertices[i];
      const z = vertices[i + 2];
      const r = Math.hypot(x, z);
      if (r > maxR) maxR = r;
    }
    return maxR;
  }
  const spitterRadius = maxHorizontalRadius(spitterMesh.vertices, SPITTER_VERTEX_STRIDE);
  const crawlerRadius = maxHorizontalRadius(crawlerMesh.vertices, CRAWLER_VERTEX_STRIDE);
  assert.ok(
    spitterRadius < crawlerRadius - 0.1,
    `射擊體水平半徑 ${spitterRadius.toFixed(3)} 應明顯小於巡行體 ${crawlerRadius.toFixed(3)}（瘦長剪影）`,
  );
});
