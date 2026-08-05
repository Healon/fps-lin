// node:test 純邏輯單元測試：能量砲充能邏輯（未滿取消不耗彈、充滿發射耗彈、範圍傷害半徑、
// 彈藥／傷害數值鎖定、tryFireFull／reset／命中回饋計時器）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EnergyCannon,
  CANNON_CHARGE_DURATION,
  CANNON_DAMAGE,
  CANNON_MAGAZINE,
  CANNON_PROJECTILE_SPEED,
  CANNON_PROJECTILE_RADIUS,
  CANNON_SPLASH_RADIUS,
} from "../../src/game/cannon.ts";

test("規格鎖定：能量砲數值必須符合 PLAN §3.3（改規格請同步改 PLAN 與本測試）", () => {
  assert.equal(CANNON_CHARGE_DURATION, 1.2);
  assert.equal(CANNON_DAMAGE, 80);
  assert.equal(CANNON_MAGAZINE, 12);
  assert.equal(CANNON_PROJECTILE_SPEED, 16);
  assert.equal(CANNON_SPLASH_RADIUS, 2.5);
});

test("初始彈藥為滿彈匣，未充能", () => {
  const c = new EnergyCannon();
  assert.equal(c.ammo, CANNON_MAGAZINE);
  assert.equal(c.isCharging, false);
  assert.equal(c.chargeProgress, 0);
  assert.equal(c.canFire, true);
});

test("chargeTick：開始充能後 chargeProgress 隨時間增加，未滿 1.2 秒放開（releaseCharge）應取消，不耗彈", () => {
  const c = new EnergyCannon();
  c.chargeTick(0.5);
  assert.equal(c.isCharging, true);
  assert.ok(c.chargeProgress > 0 && c.chargeProgress < 1);

  const result = c.releaseCharge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(result.fired, false, "未滿 1.2 秒放開應取消");
  assert.equal(result.spawnEvent, null);
  assert.equal(c.ammo, CANNON_MAGAZINE, "取消不應耗彈");
  assert.equal(c.isCharging, false, "放開後應離開充能狀態");
});

test("chargeTick：累積達 1.2 秒以上再 releaseCharge 應成功發射並耗彈，spawnEvent 含濺射半徑", () => {
  const c = new EnergyCannon();
  c.chargeTick(0.7);
  c.chargeTick(0.6); // 累積 1.3 秒 > CANNON_CHARGE_DURATION
  assert.ok(c.chargeProgress >= 1, "累積超過充能時長，進度應封頂於 1");

  const result = c.releaseCharge({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -5 });
  assert.equal(result.fired, true);
  assert.equal(c.ammo, CANNON_MAGAZINE - 1, "成功發射應耗彈 1 發");
  assert.ok(result.spawnEvent);
  assert.equal(result.spawnEvent!.damage, CANNON_DAMAGE);
  assert.equal(result.spawnEvent!.speed, CANNON_PROJECTILE_SPEED);
  assert.equal(result.spawnEvent!.radius, CANNON_PROJECTILE_RADIUS);
  assert.equal(result.spawnEvent!.splashRadius, CANNON_SPLASH_RADIUS);
  assert.equal(result.spawnEvent!.faction, "player");
  assert.deepEqual(result.spawnEvent!.pos, { x: 1, y: 2, z: 3 });
  assert.ok(Math.abs(result.spawnEvent!.dir.z - -1) < 1e-9, "方向應正規化為單位向量");
});

test("releaseCharge：未在充能中呼叫應直接回傳 fired=false，不影響彈藥", () => {
  const c = new EnergyCannon();
  const result = c.releaseCharge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(result.fired, false);
  assert.equal(c.ammo, CANNON_MAGAZINE);
});

test("cancelCharge：中止充能不耗彈，isCharging 與 chargeProgress 歸零", () => {
  const c = new EnergyCannon();
  c.chargeTick(0.3);
  c.cancelCharge();
  assert.equal(c.isCharging, false);
  assert.equal(c.chargeProgress, 0);
  assert.equal(c.ammo, CANNON_MAGAZINE);
});

test("tryFireFull：略過充能狀態機立即以滿充能效果發射一次，彈藥不足時失敗", () => {
  const c = new EnergyCannon();
  const result = c.tryFireFull({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(result.fired, true);
  assert.equal(c.ammo, CANNON_MAGAZINE - 1);
  assert.ok(result.spawnEvent);
  assert.equal(result.spawnEvent!.splashRadius, CANNON_SPLASH_RADIUS);

  c.ammo = 0;
  const empty = c.tryFireFull({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(empty.fired, false);
  assert.equal(empty.spawnEvent, null);
});

test("chargeTick：彈藥為 0 時不應開始充能", () => {
  const c = new EnergyCannon();
  c.ammo = 0;
  c.chargeTick(0.5);
  assert.equal(c.isCharging, false);
  assert.equal(c.chargeProgress, 0);
});

test("reset：彈藥回滿、充能與命中回饋歸零", () => {
  const c = new EnergyCannon();
  c.chargeTick(0.5);
  c.triggerHitMarker();
  c.reset();
  assert.equal(c.ammo, CANNON_MAGAZINE);
  assert.equal(c.isCharging, false);
  assert.equal(c.chargeProgress, 0);
  assert.equal(c.hitMarkerActive, false);
});

test("triggerHitMarker：啟動後 hitMarkerActive 為 true，時間流逝後歸零", () => {
  const c = new EnergyCannon();
  assert.equal(c.hitMarkerActive, false);
  c.triggerHitMarker();
  assert.equal(c.hitMarkerActive, true);
  c.update(1);
  assert.equal(c.hitMarkerActive, false);
});
