// node:test 純邏輯單元測試：驗證 rng 的決定性（同 seed 兩次結果全等）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fnv1a, mulberry32, stream, MASTER_SEED } from "../../src/rng/rng.ts";

test("fnv1a 對同字串回傳同值", () => {
  assert.equal(fnv1a("texture.metal_wall"), fnv1a("texture.metal_wall"));
});

test("fnv1a 對不同字串回傳不同值（高機率，非嚴格保證但可驗常見案例）", () => {
  assert.notEqual(fnv1a("texture.metal_wall"), fnv1a("level.main"));
});

test("mulberry32 對同 seed 產生完全相同的數列", () => {
  const seed = 12345;
  const a = mulberry32(seed);
  const b = mulberry32(seed);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test("mulberry32 數值落在 [0, 1) 區間", () => {
  const rng = mulberry32(999);
  for (let i = 0; i < 100; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `值 ${v} 超出 [0,1) 區間`);
  }
});

test("stream(name) 對同名稱兩次呼叫，各自展開的數列完全一致", () => {
  const a = stream("level.main");
  const b = stream("level.main");
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test("stream(name) 對不同名稱展開不同數列", () => {
  const a = stream("level.main");
  const b = stream("texture.metal_wall");
  assert.notEqual(a(), b());
});

test("MASTER_SEED 固定為 96000（PLAN §6.4 裁決值）", () => {
  assert.equal(MASTER_SEED, 96000);
});
