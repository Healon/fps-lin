// node:test 純邏輯單元測試：M2 主關卡（區域 A 至 C）的決定性、levelHash、門／撿取物／
// 敵人配置的結構正確性。取代已刪除的 room.test.ts（generateTestRoom 已淘汰）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateLevel, VERTEX_STRIDE } from "../../src/procgen/level/level.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(here, "..", "golden", "level-hash.txt");

test("generateLevel 兩次生成的 levelHash 完全一致（決定性）", () => {
  const a = generateLevel();
  const b = generateLevel();
  assert.equal(a.levelHash, b.levelHash);
});

test("generateLevel 兩次生成的幾何逐位元相同", () => {
  const a = generateLevel();
  const b = generateLevel();
  assert.deepEqual(Array.from(a.floorVertices), Array.from(b.floorVertices));
  assert.deepEqual(Array.from(a.wallVertices), Array.from(b.wallVertices));
  assert.deepEqual(Array.from(a.ceilingVertices), Array.from(b.ceilingVertices));
});

test("levelHash 為 8 位小寫十六進位字串，且與 golden 檔一致", () => {
  const level = generateLevel();
  assert.match(level.levelHash, /^[0-9a-f]{8}$/);
  const golden = readFileSync(goldenPath, "utf8").trim();
  assert.equal(level.levelHash, golden);
});

test("頂點數量可被 stride 與 24（6 面 x 4 頂點）整除", () => {
  const level = generateLevel();
  assert.equal(level.floorVertices.length % VERTEX_STRIDE, 0);
  assert.equal((level.floorVertices.length / VERTEX_STRIDE) % 24, 0);
  assert.equal(level.wallVertices.length % VERTEX_STRIDE, 0);
  assert.equal((level.wallVertices.length / VERTEX_STRIDE) % 24, 0);
});

test("門：恰好 6 扇（A／B／C／D／E／F），條件與朝向符合規格", () => {
  const level = generateLevel();
  assert.equal(level.doors.length, 6);
  const byId = Object.fromEntries(level.doors.map((d) => [d.id, d]));
  assert.equal(byId["door-a"].condition, "has-weapon");
  assert.equal(byId["door-b"].condition, "area-clear:B");
  assert.equal(byId["door-c"].condition, "area-clear:C");
  assert.equal(byId["door-d"].condition, "console-activated");
  assert.equal(byId["door-e"].condition, "area-clear:E");
  assert.equal(byId["door-f"].condition, "none", "首領戰大門：走近即開，無條件");
});

test("射擊體配置：區域 D 恰好 3 隻、區域 E 恰好 2 隻，皆標記正確 area", () => {
  const level = generateLevel();
  const d = level.spitterSpawns.filter((s) => s.area === "D");
  const e = level.spitterSpawns.filter((s) => s.area === "E");
  assert.equal(d.length, 3);
  assert.equal(e.length, 2);
  assert.equal(level.spitterSpawns.length, 5);
});

test("守衛體配置：區域 E 恰好 1 隻（M3 第二階段新增）", () => {
  const level = generateLevel();
  assert.equal(level.wardenSpawns.length, 1);
  assert.ok(level.wardenSpawns.every((w) => w.area === "E"));
});

test("控制台：已定義且位於區域 D 範圍內", () => {
  const level = generateLevel();
  assert.ok(level.consoleDef.id.length > 0);
  assert.ok(level.consoleDef.pos.x > 48 && level.consoleDef.pos.x < 62);
});

test("撿取物：手槍／散射槍／電漿步槍／能量砲各一，彈藥與醫療包依規格數量", () => {
  const level = generateLevel();
  const byKind = (kind: string) => level.pickups.filter((p) => p.kind === kind);
  assert.equal(byKind("weapon-pistol").length, 1);
  assert.equal(byKind("weapon-shotgun").length, 1);
  assert.equal(byKind("weapon-plasma").length, 1);
  assert.equal(byKind("weapon-cannon").length, 1);
  assert.equal(byKind("medkit").length, 4, "區域 C 2 加區域 E 1 加區域 F 1");
  assert.equal(byKind("ammo-pistol").length + byKind("ammo-shotgun").length + byKind("ammo-plasma").length, 7);
  assert.equal(byKind("ammo-plasma").length, 3, "區域 E 2 加區域 F 1");
});

test("敵人配置：區域 B 3 隻、區域 C 6 隻、區域 E 4 隻，皆標記正確 area", () => {
  const level = generateLevel();
  const b = level.enemySpawns.filter((e) => e.area === "B");
  const c = level.enemySpawns.filter((e) => e.area === "C");
  const e = level.enemySpawns.filter((en) => en.area === "E");
  assert.equal(b.length, 3);
  assert.equal(c.length, 6);
  assert.equal(e.length, 4);
});

test("首領固定平台點：4 至 5 個，皆落在區域 F 範圍內；能源核心緊鄰平台 0", () => {
  const level = generateLevel();
  assert.ok(level.bossPlatforms.length >= 4 && level.bossPlatforms.length <= 5, `平台數應為 4 至 5 個，實際 ${level.bossPlatforms.length}`);
  for (const p of level.bossPlatforms) {
    assert.ok(p.x > 98 && p.x < 118, `平台 x=${p.x} 應落在區域 F 範圍內`);
    assert.ok(p.z > -20 && p.z < 0, `平台 z=${p.z} 應落在區域 F 範圍內`);
  }
  const dx = level.energyCorePos.x - level.bossPlatforms[0].x;
  const dz = level.energyCorePos.z - level.bossPlatforms[0].z;
  assert.ok(Math.hypot(dx, dz) < 5, "能源核心應緊鄰首領初始平台（視覺一體）");
});

test("玩家出生點已定義且落在合理座標範圍內", () => {
  const level = generateLevel();
  assert.ok(Math.abs(level.playerSpawn.x) < 5 && Math.abs(level.playerSpawn.z) < 5);
});

test("碰撞體數量遠大於 0（牆面、柱子、台座、地板皆計入，含區域 F 8 根方柱）", () => {
  const level = generateLevel();
  assert.ok(level.colliders.length > 20, `colliders.length=${level.colliders.length}`);
});
