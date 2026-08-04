// node:test 純邏輯單元測試：脈衝手槍射速冷卻、彈藥消耗與傷害計算、raycast 先命中者算。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PulsePistol,
  PULSE_PISTOL_DAMAGE,
  PULSE_PISTOL_FIRE_RATE,
  PULSE_PISTOL_MAGAZINE,
  PULSE_PISTOL_COOLDOWN,
  AIM_ASSIST_MARGIN,
} from "../../src/game/weapons.ts";
import { Crawler, CRAWLER_MAX_HP, CRAWLER_HALF } from "../../src/game/enemy.ts";
import { rayAabbIntersect, expandAabb } from "../../src/game/collision.ts";
import type { Aabb } from "../../src/procgen/level/room.ts";

test("常數符合 PLAN §3.3 裁決值：傷害 12、射速 3 發/秒、彈藥上限 120", () => {
  assert.equal(PULSE_PISTOL_DAMAGE, 12);
  assert.equal(PULSE_PISTOL_FIRE_RATE, 3);
  assert.equal(PULSE_PISTOL_MAGAZINE, 120);
  assert.equal(PULSE_PISTOL_COOLDOWN, 1 / 3);
});

test("起始彈藥滿彈（120），首發必定可開火", () => {
  const gun = new PulsePistol();
  assert.equal(gun.ammo, PULSE_PISTOL_MAGAZINE);
  assert.equal(gun.canFire, true);
});

test("開火會消耗 1 發彈藥；冷卻中無法再次開火（fired=false 且不重複消耗彈藥）", () => {
  const gun = new PulsePistol();
  const origin = { x: 0, y: 0, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  const r1 = gun.tryFire(origin, dir, [], []);
  assert.equal(r1.fired, true);
  assert.equal(gun.ammo, PULSE_PISTOL_MAGAZINE - 1);

  const r2 = gun.tryFire(origin, dir, [], []);
  assert.equal(r2.fired, false);
  assert.equal(gun.ammo, PULSE_PISTOL_MAGAZINE - 1, "冷卻中不應消耗彈藥");
});

test("射速冷卻：經過 1/射速 秒後可再次開火", () => {
  const gun = new PulsePistol();
  const origin = { x: 0, y: 0, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  gun.tryFire(origin, dir, [], []);
  gun.update(PULSE_PISTOL_COOLDOWN - 0.01);
  assert.equal(gun.canFire, false, "冷卻未滿不應可開火");
  gun.update(0.02);
  assert.equal(gun.canFire, true, "冷卻時間到應可再次開火");
});

test("彈藥耗盡後無法開火", () => {
  const gun = new PulsePistol();
  const origin = { x: 0, y: 0, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  for (let i = 0; i < PULSE_PISTOL_MAGAZINE; i++) {
    gun.tryFire(origin, dir, [], []);
    gun.update(PULSE_PISTOL_COOLDOWN + 0.001);
  }
  assert.equal(gun.ammo, 0);
  assert.equal(gun.canFire, false);
  const result = gun.tryFire(origin, dir, [], []);
  assert.equal(result.fired, false);
});

test("reset() 恢復滿彈藥並清空計時器", () => {
  const gun = new PulsePistol();
  gun.tryFire({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, [], []);
  assert.notEqual(gun.ammo, PULSE_PISTOL_MAGAZINE);
  gun.reset();
  assert.equal(gun.ammo, PULSE_PISTOL_MAGAZINE);
  assert.equal(gun.canFire, true);
});

test("命中敵人：造成 PULSE_PISTOL_DAMAGE 傷害，HP 正確扣減", () => {
  const gun = new PulsePistol();
  const enemy = new Crawler(0, { x: 0, y: 0, z: -5 });
  const origin = { x: 0, y: enemy.getCenter().y, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  const result = gun.tryFire(origin, dir, [], [enemy]);
  assert.equal(result.fired, true);
  assert.equal(result.hitEnemy, enemy);
  assert.equal(enemy.hp, CRAWLER_MAX_HP - PULSE_PISTOL_DAMAGE);
});

test("2 發（2x12=24）恰好擊殺 HP 24 的巡行體（PLAN §3.4 v3 平衡調整）", () => {
  const gun = new PulsePistol();
  const enemy = new Crawler(0, { x: 0, y: 0, z: -5 });
  assert.equal(CRAWLER_MAX_HP, 24, "本測試假設前提：巡行體 HP 24");
  const origin = { x: 0, y: enemy.getCenter().y, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };

  const r1 = gun.tryFire(origin, dir, [], [enemy]);
  assert.equal(r1.hitEnemy, enemy);
  assert.equal(enemy.state, "hurt");
  assert.equal(enemy.hp, 12);

  gun.update(PULSE_PISTOL_COOLDOWN + 0.001);
  const r2 = gun.tryFire(origin, dir, [], [enemy]);
  assert.equal(enemy.state, "dead");
  assert.equal(enemy.hp, 0);
  assert.equal(r2.hitEnemy, enemy);
});

test("先命中者算：牆面比敵人更近時，敵人不受傷害", () => {
  const gun = new PulsePistol();
  const enemy = new Crawler(0, { x: 0, y: 0, z: -10 });
  const wall: Aabb = {
    min: { x: -1, y: -1, z: -3.5 },
    max: { x: 1, y: 2, z: -2.5 },
  };
  const origin = { x: 0, y: enemy.getCenter().y, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  const result = gun.tryFire(origin, dir, [wall], [enemy]);
  assert.equal(result.fired, true);
  assert.equal(result.hitEnemy, null, "較近的牆應擋住敵人，敵人不算命中");
  assert.equal(enemy.hp, CRAWLER_MAX_HP, "敵人 HP 不應變動");
});

test("已死亡的敵人不會再被 raycast 命中（跳過）", () => {
  const gun = new PulsePistol();
  const enemy = new Crawler(0, { x: 0, y: 0, z: -5 });
  enemy.applyDamage(100);
  assert.equal(enemy.state, "dead");
  const origin = { x: 0, y: enemy.getCenter().y, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  const result = gun.tryFire(origin, dir, [], [enemy]);
  assert.equal(result.hitEnemy, null);
});

test("瞄準寬容鎖定：切角射線在外擴前 miss、外擴後 hit（AIM_ASSIST_MARGIN=0.18）", () => {
  const enemy = new Crawler(0, { x: 0, y: 0, z: -5 });
  const tightAabb = enemy.getAabb();
  // offsetX 落在「緊 AABB 半寬」與「緊 AABB 半寬＋寬容量」之間，模擬切角擦邊的射線
  const offsetX = CRAWLER_HALF.x + AIM_ASSIST_MARGIN / 2;
  const origin = { x: offsetX, y: enemy.getCenter().y, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };

  assert.equal(rayAabbIntersect(origin, dir, tightAabb), null, "外擴前：緊 AABB 應 miss");

  const expanded = expandAabb(tightAabb, AIM_ASSIST_MARGIN);
  assert.notEqual(rayAabbIntersect(origin, dir, expanded), null, "外擴後：寬容 AABB 應 hit");

  // 整合測試：實際透過 PulsePistol.tryFire 驗證瞄準寬容確實生效
  const gun = new PulsePistol();
  const result = gun.tryFire(origin, dir, [], [enemy]);
  assert.equal(result.hitEnemy, enemy, "武器 raycast 內建瞄準寬容應命中此切角射線");
});
