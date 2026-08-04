// node:test 純邏輯單元測試：射擊視覺效果的生命週期（觸發後 t=0 有效、超過存活時間即失效）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { Recoil, MuzzleFlashEffect, TracerEffect, SparkEffect, WeaponSwitchEffect } from "../../src/game/effects.ts";

test("Recoil：未觸發時 amount 為 0；trigger 後隨即進入上升段，超過總時長後衰減回 0", () => {
  const r = new Recoil();
  assert.equal(r.amount, 0);
  assert.equal(r.active, false);

  r.trigger();
  assert.equal(r.active, true, "trigger 瞬間（t=0）即視為 active，即使 amount 剛從 0 起漲");
  assert.equal(r.amount, 0, "t=0 時上升段起點為 0，符合『從 0 開始 kick』的設計");

  r.update(0.008); // 上升段內（attack 段為 80ms 的前 20%＝16ms）
  assert.ok(r.amount > 0, "上升段內應 >0");

  r.update(0.1); // 累積遠超過 80ms
  assert.equal(r.active, false);
  assert.equal(r.amount, 0);
});

test("Recoil：先上升後衰減（峰值出現在 attack 段結束附近，之後單調遞減）", () => {
  const r = new Recoil();
  r.trigger();
  const early = r.amount; // t=0
  r.update(0.016); // 約 attack 段結束（80ms * 20% = 16ms）
  const peak = r.amount;
  r.update(0.03);
  const later = r.amount;
  assert.ok(peak >= early, `peak(${peak}) 應 >= early(${early})`);
  assert.ok(later < peak, `later(${later}) 應 < peak(${peak})，代表衰減中`);
});

test("MuzzleFlashEffect：trigger 後 t=0 為 active，超過存活時間後失效", () => {
  const flash = new MuzzleFlashEffect();
  assert.equal(flash.active, false);
  flash.trigger();
  assert.equal(flash.active, true);
  flash.update(0.02);
  assert.equal(flash.active, true, "仍在存活時間內");
  flash.update(0.05);
  assert.equal(flash.active, false, "應已超過存活時間");
});

test("TracerEffect：trigger 後 current 回傳資料，超過存活時間後回 null 且 active=false", () => {
  const tracer = new TracerEffect();
  assert.equal(tracer.active, false);
  assert.equal(tracer.current, null);

  const data = { origin: { x: 0, y: 1.7, z: 0 }, hitPoint: { x: 0, y: 1, z: -5 } };
  tracer.trigger(data);
  assert.equal(tracer.active, true);
  assert.deepEqual(tracer.current, data);

  tracer.update(0.05);
  assert.equal(tracer.active, true, "60ms 存活時間內");

  tracer.update(0.02); // 累積 0.07s，超過 0.06s 存活時間
  assert.equal(tracer.active, false);
  assert.equal(tracer.current, null);
});

test("SparkEffect：trigger 後 current 回傳資料且 kind 正確，超過存活時間後失效；progress 隨時間增加", () => {
  const spark = new SparkEffect();
  assert.equal(spark.active, false);
  assert.equal(spark.progress, 1);

  spark.trigger({ point: { x: 1, y: 1, z: -3 }, kind: "enemy" });
  assert.equal(spark.active, true);
  assert.equal(spark.current?.kind, "enemy");
  assert.equal(spark.progress, 0);

  spark.update(0.075); // 一半存活時間（150ms 的一半）
  assert.ok(spark.active);
  assert.ok(spark.progress > 0.4 && spark.progress < 0.6, `progress=${spark.progress}`);

  spark.update(0.1); // 累積 0.175s，超過 0.15s 存活時間
  assert.equal(spark.active, false);
  assert.equal(spark.current, null);
  assert.equal(spark.progress, 1);
});

test("WeaponSwitchEffect：trigger 後 dipAmount 兩端為 0、中點達峰值，超過時長後 active=false", () => {
  const sw = new WeaponSwitchEffect();
  assert.equal(sw.active, false);
  assert.equal(sw.dipAmount, 0);

  sw.trigger();
  assert.equal(sw.active, true);
  assert.equal(sw.dipAmount, 0, "t=0 應為 0（原位起跳）");

  sw.update(0.125); // 約總時長一半（0.25s 的 50%）
  assert.ok(sw.dipAmount > 0.9, `中點應接近峰值 1，實際 ${sw.dipAmount}`);

  sw.update(0.2); // 累積 0.325s，超過 0.25s
  assert.equal(sw.active, false);
  assert.equal(sw.dipAmount, 0);
});

test("SparkEffect：可重複 trigger，新資料覆蓋舊資料並重置存活時間", () => {
  const spark = new SparkEffect();
  spark.trigger({ point: { x: 0, y: 0, z: 0 }, kind: "wall" });
  spark.update(0.1);
  assert.ok(spark.progress > 0.5);

  spark.trigger({ point: { x: 2, y: 2, z: -2 }, kind: "enemy" });
  assert.equal(spark.progress, 0, "重新 trigger 應重置存活時間");
  assert.equal(spark.current?.kind, "enemy");
});
