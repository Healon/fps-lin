// node:test 純邏輯單元測試：遊戲狀態機轉移表（menu／playing／paused）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStateMachine } from "../../src/game/state.ts";

test("初始狀態為 menu", () => {
  const gs = new GameStateMachine();
  assert.equal(gs.state, "menu");
});

test("menu → playing → paused → playing（start／pause／resume）", () => {
  const gs = new GameStateMachine();
  gs.start();
  assert.equal(gs.state, "playing");
  gs.pause();
  assert.equal(gs.state, "paused");
  gs.resume();
  assert.equal(gs.state, "playing");
});

test("paused → playing（restart）", () => {
  const gs = new GameStateMachine();
  gs.start();
  gs.pause();
  assert.equal(gs.state, "paused");
  gs.restart();
  assert.equal(gs.state, "playing");
});

test("setState 可直接跳轉任意狀態，供 debug.setState() 測試切態使用", () => {
  const gs = new GameStateMachine();
  gs.setState("paused");
  assert.equal(gs.state, "paused");
  gs.setState("menu");
  assert.equal(gs.state, "menu");
});

test("onChange 監聽者於狀態改變時被呼叫，攜帶 next／previous", () => {
  const gs = new GameStateMachine();
  const calls: Array<[string, string]> = [];
  gs.onChange((next, previous) => calls.push([next, previous]));
  gs.start();
  gs.pause();
  gs.resume();
  assert.deepEqual(calls, [
    ["playing", "menu"],
    ["paused", "playing"],
    ["playing", "paused"],
  ]);
});

test("相同狀態重複設定不觸發監聽者", () => {
  const gs = new GameStateMachine();
  let count = 0;
  gs.onChange(() => count++);
  gs.setState("menu"); // 已是 menu，不應觸發
  assert.equal(count, 0);
  gs.start();
  assert.equal(count, 1);
  gs.setState("playing"); // 已是 playing，不應再觸發
  assert.equal(count, 1);
});
