// node:test 純邏輯單元測試：控制台互動系統（提示可見性、啟動成功／失敗條件、reset、force）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConsoleSystem } from "../../src/game/console.ts";

const DEF = { id: "console-d", pos: { x: 58, y: 0, z: -10 } };

test("初始狀態：未啟動，範圍內顯示提示，範圍外不顯示", () => {
  const sys = new ConsoleSystem(DEF);
  assert.equal(sys.isActivated, false);
  assert.equal(sys.isPromptVisible({ x: 58, y: 0, z: -9 }), true, "距離 1m 應在提示半徑內");
  assert.equal(sys.isPromptVisible({ x: 58, y: 0, z: -5 }), false, "距離 5m 應超出提示半徑");
});

test("tryActivate：範圍外失敗、範圍內成功且之後恆回 false（一次性）", () => {
  const sys = new ConsoleSystem(DEF);
  assert.equal(sys.tryActivate({ x: 58, y: 0, z: -5 }), false, "範圍外不應啟動");
  assert.equal(sys.isActivated, false);

  assert.equal(sys.tryActivate({ x: 58, y: 0, z: -9 }), true, "範圍內應成功啟動");
  assert.equal(sys.isActivated, true);

  assert.equal(sys.tryActivate({ x: 58, y: 0, z: -9 }), false, "已啟動後重複呼叫應回 false，不重複觸發");
});

test("啟動後 isPromptVisible 恆回 false（提示只在尚未啟動時顯示）", () => {
  const sys = new ConsoleSystem(DEF);
  sys.tryActivate({ x: 58, y: 0, z: -9 });
  assert.equal(sys.isPromptVisible({ x: 58, y: 0, z: -9 }), false);
});

test("forceActivate：略過距離檢查，供 debug 後門使用；已啟動則回 false", () => {
  const sys = new ConsoleSystem(DEF);
  assert.equal(sys.forceActivate(), true);
  assert.equal(sys.isActivated, true);
  assert.equal(sys.forceActivate(), false, "重複強制啟動應回 false");
});

test("reset：回到未啟動狀態", () => {
  const sys = new ConsoleSystem(DEF);
  sys.forceActivate();
  assert.equal(sys.isActivated, true);
  sys.reset();
  assert.equal(sys.isActivated, false);
});
