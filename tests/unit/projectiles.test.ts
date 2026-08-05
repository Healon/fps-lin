// node:test 純邏輯單元測試：共用投射物系統（掃掠命中牆／目標、超時消滅、物件池重用）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectileSystem } from "../../src/game/projectiles.ts";
import type { Aabb } from "../../src/procgen/level/level.ts";
import type { ProjectileTarget } from "../../src/game/projectiles.ts";

function makeTarget(aabb: Aabb, hp = 100): ProjectileTarget & { hp: number } {
  return {
    hp,
    getAabb: () => aabb,
    applyDamage(amount: number): boolean {
      this.hp = Math.max(0, this.hp - amount);
      return this.hp <= 0;
    },
  };
}

const NO_TARGETS = () => [];

test("無牆無目標：正常沿方向推進，未消滅，無命中事件", () => {
  const sys = new ProjectileSystem();
  sys.spawn({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 }, speed: 10, damage: 8, radius: 0.3, faction: "enemy", color: [1, 0.4, 0.15] });
  const events = sys.update(1 / 60, [], NO_TARGETS);
  assert.equal(events.length, 0);
  assert.equal(sys.aliveCount, 1);
  const [inst] = sys.instances;
  assert.ok(Math.abs(inst.pos.z - -(10 / 60)) < 1e-9, `應沿 -Z 推進 10/60m，實際 z=${inst.pos.z}`);
});

// 以下命中類測試皆用 dt=1（配合 speed 讓單次 update 的本幀移動距離足以覆蓋到目標／牆面），
// 避免誤把「單幀移動距離不足以觸及」誤判為「命中判定沒生效」（掃掠本就是逐幀累積接近，
// 多幀後才命中是正常行為，見 game/projectiles.ts 檔頭註解）。

test("打牆：命中關卡 AABB 即消滅，不回報命中事件", () => {
  const sys = new ProjectileSystem();
  sys.spawn({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 }, speed: 10, damage: 8, radius: 0.3, faction: "enemy", color: [1, 0.4, 0.15] });
  const wall: Aabb = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: -0.5 } };
  const events = sys.update(1, [wall], NO_TARGETS);
  assert.equal(events.length, 0, "打牆不應回報命中事件");
  assert.equal(sys.aliveCount, 0, "打牆應消滅投射物");
});

test("打玩家（enemy 陣營）：命中目標造成傷害並回報命中事件", () => {
  const sys = new ProjectileSystem();
  sys.spawn({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 }, speed: 10, damage: 8, radius: 0.3, faction: "enemy", color: [1, 0.4, 0.15] });
  const player = makeTarget({ min: { x: -0.4, y: 0, z: -1 }, max: { x: 0.4, y: 2, z: -0.9 } });
  const events = sys.update(1, [], (faction) => (faction === "enemy" ? [player] : []));
  assert.equal(events.length, 1);
  assert.equal(events[0].target, player);
  assert.equal(player.hp, 92);
  assert.equal(sys.aliveCount, 0, "命中後應消滅");
});

test("打敵人（player 陣營）：died 正確回報致命一擊", () => {
  const sys = new ProjectileSystem();
  sys.spawn({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 }, speed: 10, damage: 100, radius: 0.3, faction: "player", color: [0.35, 0.88, 1] });
  const enemy = makeTarget({ min: { x: -0.4, y: 0, z: -1 }, max: { x: 0.4, y: 2, z: -0.9 } }, 45);
  const events = sys.update(1, [], (faction) => (faction === "player" ? [enemy] : []));
  assert.equal(events.length, 1);
  assert.equal(events[0].died, true);
  assert.equal(enemy.hp, 0);
});

test("先命中者算：牆比目標近時，目標不受傷害且無命中事件（視為打牆）", () => {
  const sys = new ProjectileSystem();
  sys.spawn({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 }, speed: 10, damage: 8, radius: 0.3, faction: "enemy", color: [1, 0.4, 0.15] });
  const wall: Aabb = { min: { x: -1, y: 0, z: -0.4 }, max: { x: 1, y: 2, z: -0.2 } }; // 較近的牆
  const player = makeTarget({ min: { x: -0.4, y: 0, z: -1 }, max: { x: 0.4, y: 2, z: -0.9 } }); // 較遠的目標
  const events = sys.update(1, [wall], (faction) => (faction === "enemy" ? [player] : []));
  assert.equal(events.length, 0);
  assert.equal(player.hp, 100, "較近的牆應擋住，目標不應受傷");
  assert.equal(sys.aliveCount, 0);
});

test("超時消滅：超過 3 秒存活時間即消滅，無命中事件", () => {
  const sys = new ProjectileSystem();
  sys.spawn({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 }, speed: 1, damage: 8, radius: 0.3, faction: "enemy", color: [1, 0.4, 0.15] });
  let totalEvents = 0;
  for (let i = 0; i < 200; i++) {
    // 200 * (1/60) ≈ 3.33s > 3s
    totalEvents += sys.update(1 / 60, [], NO_TARGETS).length;
  }
  assert.equal(totalEvents, 0);
  assert.equal(sys.aliveCount, 0, "超過最大存活時間應消滅");
});

test("物件池重用：多次 spawn／消滅後，pool 陣列大小不隨呼叫次數無限增長", () => {
  const sys = new ProjectileSystem();
  const wall: Aabb = { min: { x: -1, y: 0, z: -0.5 }, max: { x: 1, y: 2, z: 0.5 } };
  for (let i = 0; i < 20; i++) {
    sys.spawn({ pos: { x: 0, y: 1, z: 5 }, dir: { x: 0, y: 0, z: -1 }, speed: 100, damage: 8, radius: 0.3, faction: "enemy", color: [1, 0.4, 0.15] });
    sys.update(1, [wall], NO_TARGETS); // 每發皆立即打牆消滅（dt=1 保證單次涵蓋整段距離），槽位可被下次 spawn 覆寫重用
  }
  assert.ok(sys.poolSize <= 2, `pool 陣列大小應被重用機制壓在很小範圍內，實際 ${sys.poolSize}`);
  assert.equal(sys.aliveCount, 0);
});

test("同時多發存活：instances 回報全部存活投射物", () => {
  const sys = new ProjectileSystem();
  sys.spawn({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 }, speed: 5, damage: 8, radius: 0.3, faction: "enemy", color: [1, 0.4, 0.15] });
  sys.spawn({ pos: { x: 2, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 }, speed: 5, damage: 8, radius: 0.3, faction: "enemy", color: [1, 0.4, 0.15] });
  sys.update(1 / 60, [], NO_TARGETS);
  assert.equal(sys.instances.length, 2);
});
