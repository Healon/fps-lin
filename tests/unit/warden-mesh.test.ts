// node:test 純邏輯單元測試：守衛體程序化模型的決定性、非空、站立高度、背部警示橘、
// 正面裝甲板存在、命中包絡不變量、剪影與另兩種敵人可分。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWardenMesh, WARDEN_VERTEX_STRIDE } from "../../src/procgen/mesh/warden.ts";
import { WARDEN_HALF } from "../../src/game/warden.ts";
import { AIM_ASSIST_MARGIN } from "../../src/game/weapons.ts";

test("generateWardenMesh 兩次生成的頂點與索引逐位元相同（同 seed 決定性）", () => {
  const a = generateWardenMesh();
  const b = generateWardenMesh();
  assert.deepEqual(Array.from(a.vertices), Array.from(b.vertices));
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
});

test("generateWardenMesh 產出非空幾何（有值不等於有效：至少要有頂點與索引）", () => {
  const mesh = generateWardenMesh();
  assert.ok(mesh.vertices.length > 0, "頂點陣列不可為空");
  assert.ok(mesh.indices.length > 0, "索引陣列不可為空");
});

test("頂點數量可被 stride 整除，且每面 4 頂點 6 面故可被 24 整除", () => {
  const mesh = generateWardenMesh();
  assert.equal(mesh.vertices.length % WARDEN_VERTEX_STRIDE, 0);
  const vertexCount = mesh.vertices.length / WARDEN_VERTEX_STRIDE;
  assert.equal(vertexCount % 24, 0);
});

test("索引值皆落在頂點數量範圍內（無越界索引）", () => {
  const mesh = generateWardenMesh();
  const vertexCount = mesh.vertices.length / WARDEN_VERTEX_STRIDE;
  for (const idx of mesh.indices) {
    assert.ok(idx >= 0 && idx < vertexCount, `索引 ${idx} 越界（頂點數 ${vertexCount}）`);
  }
});

function colorAt(vertices: Float32Array, i: number): [number, number, number] {
  return [vertices[i + 6], vertices[i + 7], vertices[i + 8]];
}

function isWarningColor(r: number, g: number, b: number): boolean {
  return Math.abs(r - 0xff / 255) < 0.01 && Math.abs(g - 0x5a / 255) < 0.01 && Math.abs(b - 0x26 / 255) < 0.01;
}

test("實際從面向方向可見的一側（pz 面，z>0）不含警示橘，從背後可見的一側（nz 面，z<0）含警示橘（弱點視覺教學：繞背才看得到）", () => {
  // 註：appendColoredBox（procgen/mesh/box.ts）的 nz／pz 四邊形實際三角形繞序與宣告的
  // normal 方向相反（render-first 驗收以精確相機位置實測確認，見 warden.ts 對應註解），
  // 故「z<0（nz 面）」才是站在 facingYaw 指向方向（即面向玩家時）實際看不到、要繞到背後
  // 才看得到的一側；本測試依實際渲染可見性（而非宣告 normal 的字面方向）鎖定色彩配置。
  const mesh = generateWardenMesh();
  let foundWarningNz = false; // z<0：背後才可見（弱點）
  let foundWarningPz = false; // z>0：面向玩家時可見（應為深色裝甲，不可有警示橘）
  for (let i = 0; i < mesh.vertices.length; i += WARDEN_VERTEX_STRIDE) {
    const z = mesh.vertices[i + 2];
    const [r, g, b] = colorAt(mesh.vertices, i);
    if (isWarningColor(r, g, b)) {
      if (z < 0) foundWarningNz = true;
      if (z > 0) foundWarningPz = true;
    }
  }
  assert.ok(foundWarningNz, "z<0（nz 面，背後才可見）應至少有一個警示橘頂點色");
  assert.ok(!foundWarningPz, "z>0（pz 面，面向玩家時可見）不應出現警示橘頂點色（本次派工規格：弱點視覺教學）");
});

test("站立總高鎖定在 2.0±0.15m（本次派工規格：厚重寬體約 2.0m 高）", () => {
  const mesh = generateWardenMesh();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.vertices.length; i += WARDEN_VERTEX_STRIDE) {
    const y = mesh.vertices[i + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  assert.ok(Math.abs(height - 2.0) <= 0.15, `站立高度應為 2.0±0.15m，實際 ${height}`);
});

test("視覺不超出命中包絡：任何頂點的水平半徑 ≤ min(WARDEN_HALF.x, z) + AIM_ASSIST_MARGIN（含安全餘量）", () => {
  const mesh = generateWardenMesh();
  const limit = Math.min(WARDEN_HALF.x, WARDEN_HALF.z) + AIM_ASSIST_MARGIN - 0.005;
  let maxRadius = 0;
  for (let i = 0; i < mesh.vertices.length; i += WARDEN_VERTEX_STRIDE) {
    const x = mesh.vertices[i];
    const z = mesh.vertices[i + 2];
    const r = Math.hypot(x, z);
    if (r > maxRadius) maxRadius = r;
  }
  assert.ok(maxRadius <= limit, `最大水平半徑 ${maxRadius.toFixed(3)} 超出命中包絡上限 ${limit.toFixed(3)}`);
});

test("剪影與另兩種敵人明顯不同：守衛體水平最大半徑（寬體）應明顯大於巡行體與射擊體", async () => {
  const { generateCrawlerMesh, CRAWLER_VERTEX_STRIDE } = await import("../../src/procgen/mesh/crawler.ts");
  const { generateSpitterMesh, SPITTER_VERTEX_STRIDE } = await import("../../src/procgen/mesh/spitter.ts");
  const wardenMesh = generateWardenMesh();
  const crawlerMesh = generateCrawlerMesh();
  const spitterMesh = generateSpitterMesh();

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
  const wardenRadius = maxHorizontalRadius(wardenMesh.vertices, WARDEN_VERTEX_STRIDE);
  const crawlerRadius = maxHorizontalRadius(crawlerMesh.vertices, CRAWLER_VERTEX_STRIDE);
  const spitterRadius = maxHorizontalRadius(spitterMesh.vertices, SPITTER_VERTEX_STRIDE);
  assert.ok(
    wardenRadius > crawlerRadius + 0.05,
    `守衛體水平半徑 ${wardenRadius.toFixed(3)} 應明顯大於巡行體 ${crawlerRadius.toFixed(3)}（寬體剪影）`,
  );
  assert.ok(
    wardenRadius > spitterRadius + 0.05,
    `守衛體水平半徑 ${wardenRadius.toFixed(3)} 應明顯大於射擊體 ${spitterRadius.toFixed(3)}（寬體剪影）`,
  );
});
