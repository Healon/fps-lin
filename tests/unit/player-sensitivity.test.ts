// node:test 純邏輯單元測試：PlayerController.setSensitivity() 對滑鼠視角與方向鍵視角轉速的效果。
// PlayerController 本身無 DOM／WebGL 依賴（僅純數學與 Aabb 資料），可直接在 Node 測試。
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerController } from "../../src/game/player.ts";
import type { InputState } from "../../src/core/input.ts";

function baseInput(overrides: Partial<InputState> = {}): InputState {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    lookLeft: false,
    lookRight: false,
    lookUp: false,
    lookDown: false,
    pointerLocked: true,
    fire: false,
    fireKey: false,
    ...overrides,
  };
}

test("getSensitivity() 預設為 1.0，setSensitivity() 可讀回設定值", () => {
  const player = new PlayerController({ x: 0, y: 0, z: 0 });
  assert.equal(player.getSensitivity(), 1.0);
  player.setSensitivity(1.75);
  assert.equal(player.getSensitivity(), 1.75);
});

test("setSensitivity(2.0) 使滑鼠 yaw／pitch 變化量精確加倍（0.5～2.0 範圍內為線性倍率）", () => {
  const a = new PlayerController({ x: 0, y: 0, z: 0 });
  const b = new PlayerController({ x: 0, y: 0, z: 0 });
  b.setSensitivity(2.0);

  a.update(0, baseInput(), { dx: 100, dy: -50 }, []);
  b.update(0, baseInput(), { dx: 100, dy: -50 }, []);

  assert.ok(Math.abs(a.yaw) > 1e-9, "基準倍率應產生非零 yaw 變化");
  assert.equal(b.yaw / a.yaw, 2);
  assert.equal(b.pitch / a.pitch, 2);
});

test("setSensitivity(0.5) 使滑鼠 yaw 變化量精確減半", () => {
  const a = new PlayerController({ x: 0, y: 0, z: 0 });
  const b = new PlayerController({ x: 0, y: 0, z: 0 });
  b.setSensitivity(0.5);

  a.update(0, baseInput(), { dx: 80, dy: 0 }, []);
  b.update(0, baseInput(), { dx: 80, dy: 0 }, []);

  assert.equal(b.yaw / a.yaw, 0.5);
});

test("靈敏度倍率同時作用於方向鍵視角轉速（無滑鼠替代操控）", () => {
  const a = new PlayerController({ x: 0, y: 0, z: 0 });
  const b = new PlayerController({ x: 0, y: 0, z: 0 });
  b.setSensitivity(2.0);
  const dt = 1 / 60;

  a.update(dt, baseInput({ lookLeft: true }), { dx: 0, dy: 0 }, []);
  b.update(dt, baseInput({ lookLeft: true }), { dx: 0, dy: 0 }, []);

  assert.ok(Math.abs(a.yaw) > 1e-9, "方向鍵應產生非零 yaw 變化");
  assert.equal(b.yaw / a.yaw, 2);
});
