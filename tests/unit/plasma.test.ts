// node:test 純邏輯單元測試：電漿步槍射速、傷害、彈藥、spawnEvent 欄位、命中回饋計時器。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PlasmaRifle,
  PLASMA_RIFLE_DAMAGE,
  PLASMA_RIFLE_FIRE_RATE,
  PLASMA_RIFLE_MAGAZINE,
  PLASMA_RIFLE_COOLDOWN,
  PLASMA_PROJECTILE_SPEED,
} from "../../src/game/plasma.ts";

test("規格鎖定：電漿步槍數值必須符合 PLAN §3.3（改規格請同步改 PLAN 與本測試）", () => {
  assert.equal(PLASMA_RIFLE_DAMAGE, 14);
  assert.equal(PLASMA_RIFLE_FIRE_RATE, 6);
  assert.equal(PLASMA_RIFLE_MAGAZINE, 180);
  assert.equal(PLASMA_PROJECTILE_SPEED, 20);
  assert.ok(Math.abs(PLASMA_RIFLE_COOLDOWN - 1 / 6) < 1e-9);
});

test("初始彈藥為滿彈匣", () => {
  const p = new PlasmaRifle();
  assert.equal(p.ammo, PLASMA_RIFLE_MAGAZINE);
  assert.equal(p.canFire, true);
});

test("tryFire：成功發射消耗 1 發彈藥並回傳正規化方向的 spawnEvent", () => {
  const p = new PlasmaRifle();
  const result = p.tryFire({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -5 });
  assert.equal(result.fired, true);
  assert.equal(p.ammo, PLASMA_RIFLE_MAGAZINE - 1);
  assert.ok(result.spawnEvent);
  assert.equal(result.spawnEvent!.damage, PLASMA_RIFLE_DAMAGE);
  assert.equal(result.spawnEvent!.speed, PLASMA_PROJECTILE_SPEED);
  assert.equal(result.spawnEvent!.faction, "player");
  assert.deepEqual(result.spawnEvent!.pos, { x: 1, y: 2, z: 3 });
  assert.ok(Math.abs(result.spawnEvent!.dir.z - -1) < 1e-9, "方向應正規化為單位向量");
});

test("射速由冷卻限制：連續呼叫 tryFire 在冷卻內第二次應失敗，冷卻後才能再度發射", () => {
  const p = new PlasmaRifle();
  const first = p.tryFire({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(first.fired, true);

  const second = p.tryFire({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(second.fired, false, "冷卻中不應再次發射");
  assert.equal(second.spawnEvent, null);
  assert.equal(p.ammo, PLASMA_RIFLE_MAGAZINE - 1, "未成功發射不應消耗彈藥");

  p.update(PLASMA_RIFLE_COOLDOWN + 0.001);
  const third = p.tryFire({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(third.fired, true, "冷卻結束後應可再次發射");
});

test("彈藥耗盡時無法發射", () => {
  const p = new PlasmaRifle();
  p.ammo = 0;
  const result = p.tryFire({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(result.fired, false);
  assert.equal(p.canFire, false);
});

test("reset：彈藥回滿、冷卻與命中回饋歸零", () => {
  const p = new PlasmaRifle();
  p.tryFire({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  p.triggerHitMarker();
  p.reset();
  assert.equal(p.ammo, PLASMA_RIFLE_MAGAZINE);
  assert.equal(p.canFire, true);
  assert.equal(p.hitMarkerActive, false);
});

test("triggerHitMarker：啟動後 hitMarkerActive 為 true，時間流逝後歸零", () => {
  const p = new PlasmaRifle();
  assert.equal(p.hitMarkerActive, false);
  p.triggerHitMarker();
  assert.equal(p.hitMarkerActive, true);
  p.update(1);
  assert.equal(p.hitMarkerActive, false);
});
