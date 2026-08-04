// node:test 純邏輯單元測試：散射槍常數、決定性散佈、彈藥消耗與多珠傷害計算。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ScatterShotgun,
  SCATTER_PELLET_COUNT,
  SCATTER_PELLET_DAMAGE,
  SCATTER_FIRE_RATE,
  SCATTER_MAGAZINE,
  SCATTER_COOLDOWN,
  scatterDirections,
} from "../../src/game/shotgun.ts";
import { Crawler, CRAWLER_MAX_HP } from "../../src/game/enemy.ts";

test("常數符合 PLAN §3.3 本次派工規格：6 珠、每珠 8 傷、射速 1.2 發/秒、彈藥上限 48", () => {
  assert.equal(SCATTER_PELLET_COUNT, 6);
  assert.equal(SCATTER_PELLET_DAMAGE, 8);
  assert.equal(SCATTER_FIRE_RATE, 1.2);
  assert.equal(SCATTER_MAGAZINE, 48);
  assert.ok(Math.abs(SCATTER_COOLDOWN - 1 / 1.2) < 1e-9);
});

test("scatterDirections：同一開火序號兩次呼叫得到逐位元相同的散佈方向（決定性）", () => {
  const forward = { x: 0, y: 0, z: -1 };
  const a = scatterDirections(3, forward);
  const b = scatterDirections(3, forward);
  assert.deepEqual(a, b);
  assert.equal(a.length, SCATTER_PELLET_COUNT);
});

test("scatterDirections：不同開火序號得到不同的散佈方向", () => {
  const forward = { x: 0, y: 0, z: -1 };
  const a = scatterDirections(0, forward);
  const c = scatterDirections(1, forward);
  assert.notDeepEqual(a, c);
});

test("scatterDirections：每個方向皆為單位向量，且落在 forward 為軸的窄錐內", () => {
  const forward = { x: 0, y: 0, z: -1 };
  const dirs = scatterDirections(5, forward);
  for (const d of dirs) {
    const len = Math.hypot(d.x, d.y, d.z);
    assert.ok(Math.abs(len - 1) < 1e-6, `方向應為單位向量，實際長度 ${len}`);
    const cosAngle = -d.z; // dot(d, forward)
    assert.ok(cosAngle > 0.99, `散佈角度過大，cos(angle)=${cosAngle}`);
  }
});

test("起始彈藥滿彈（48），首發必定可開火，消耗 1 發", () => {
  const gun = new ScatterShotgun();
  assert.equal(gun.ammo, SCATTER_MAGAZINE);
  const origin = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };
  const result = gun.tryFire(origin, forward, [], []);
  assert.equal(result.fired, true);
  assert.equal(result.pellets.length, SCATTER_PELLET_COUNT);
  assert.equal(gun.ammo, SCATTER_MAGAZINE - 1);
});

test("射速冷卻：開火後未到冷卻時間無法再開火", () => {
  const gun = new ScatterShotgun();
  const origin = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };
  gun.tryFire(origin, forward, [], []);
  assert.equal(gun.canFire, false);
  gun.update(SCATTER_COOLDOWN + 0.01);
  assert.equal(gun.canFire, true);
});

test("彈藥耗盡後無法開火", () => {
  const gun = new ScatterShotgun();
  const origin = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };
  for (let i = 0; i < SCATTER_MAGAZINE; i++) {
    gun.tryFire(origin, forward, [], []);
    gun.update(SCATTER_COOLDOWN + 0.001);
  }
  assert.equal(gun.ammo, 0);
  assert.equal(gun.canFire, false);
  assert.equal(gun.tryFire(origin, forward, [], []).fired, false);
});

test("reset() 恢復滿彈藥並歸零開火序號（散佈序列可從頭重現）", () => {
  const gun = new ScatterShotgun();
  const origin = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };
  const before = gun.tryFire(origin, forward, [], []);
  gun.reset();
  assert.equal(gun.ammo, SCATTER_MAGAZINE);
  const after = gun.tryFire(origin, forward, [], []);
  assert.deepEqual(
    after.pellets.map((p) => p.hitPoint),
    before.pellets.map((p) => p.hitPoint),
  );
});

test("近距離朝敵人開火：至少一珠命中並造成傷害（6 珠每珠 8 傷，密集散佈下近距必中）", () => {
  const gun = new ScatterShotgun();
  const enemy = new Crawler(0, { x: 0, y: 0, z: -3 });
  const origin = { x: 0, y: enemy.getCenter().y, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };
  const result = gun.tryFire(origin, forward, [], [enemy]);
  const hits = result.pellets.filter((p) => p.hitEnemy === enemy);
  assert.ok(hits.length > 0, "近距離朝敵人正面開火應至少一珠命中");
  assert.equal(enemy.hp, CRAWLER_MAX_HP - hits.length * SCATTER_PELLET_DAMAGE);
});
