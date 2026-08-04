// node:test 純邏輯單元測試：門系統狀態機（closed→opening→open）、條件加靠近距離觸發、
// 滑動進度、鎖定提示文字、active colliders 隨狀態增減。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DoorSystem, DOOR_SLIDE_DURATION } from "../../src/game/doors.ts";
import type { DoorDef } from "../../src/procgen/level/level.ts";

function makeDoor(id: string, condition: DoorDef["condition"], pos = { x: 0, y: 0, z: 0 }): DoorDef {
  return {
    id,
    pos,
    yaw: 0,
    condition,
    collider: { min: { x: pos.x - 1, y: 0, z: pos.z - 0.1 }, max: { x: pos.x + 1, y: 3, z: pos.z + 0.1 } },
  };
}

const NEUTRAL_CTX = { hasWeapon: false, areaClearB: false, areaClearC: false };

test("初始狀態：所有門 closed，progress=0，碰撞體皆計入 active colliders", () => {
  const doorA = makeDoor("door-a", "has-weapon");
  const sys = new DoorSystem([doorA]);
  assert.equal(sys.get("door-a")!.status, "closed");
  assert.equal(sys.activeColliders().length, 1);
});

test("條件未達成時，即使玩家貼近也不會開始滑開", () => {
  const doorA = makeDoor("door-a", "has-weapon");
  const sys = new DoorSystem([doorA]);
  sys.update(1 / 60, NEUTRAL_CTX, { x: 0, y: 0, z: 0 });
  assert.equal(sys.get("door-a")!.status, "closed");
});

test("條件達成但玩家距離過遠時不觸發", () => {
  const doorA = makeDoor("door-a", "has-weapon", { x: 0, y: 0, z: -4 });
  const sys = new DoorSystem([doorA]);
  sys.update(1 / 60, { ...NEUTRAL_CTX, hasWeapon: true }, { x: 0, y: 0, z: 10 });
  assert.equal(sys.get("door-a")!.status, "closed");
});

test("條件達成且玩家在 2m 內：開始滑開，0.8 秒後完全開啟，collider 移出 active list", () => {
  const doorA = makeDoor("door-a", "has-weapon", { x: 0, y: 0, z: -4 });
  const sys = new DoorSystem([doorA]);
  const ctx = { ...NEUTRAL_CTX, hasWeapon: true };
  const playerPos = { x: 0, y: 0, z: -3 }; // 距門 1m，在 2m 觸發半徑內

  sys.update(1 / 60, ctx, playerPos);
  assert.equal(sys.get("door-a")!.status, "opening");
  assert.equal(sys.activeColliders().length, 1, "opening 中仍應計入碰撞");

  for (let i = 0; i < Math.ceil(DOOR_SLIDE_DURATION * 60) + 5; i++) {
    sys.update(1 / 60, ctx, playerPos);
  }
  assert.equal(sys.get("door-a")!.status, "open");
  assert.equal(sys.get("door-a")!.progress, 1);
  assert.equal(sys.activeColliders().length, 0, "全開後應移出 active colliders");
});

test("onOpenStart 回呼恰好在開始滑動當幀觸發一次", () => {
  const doorA = makeDoor("door-a", "has-weapon", { x: 0, y: 0, z: -4 });
  const sys = new DoorSystem([doorA]);
  const calls: string[] = [];
  sys.onOpenStart((id) => calls.push(id));
  const ctx = { ...NEUTRAL_CTX, hasWeapon: true };
  const playerPos = { x: 0, y: 0, z: -3 };

  sys.update(1 / 60, ctx, playerPos);
  sys.update(1 / 60, ctx, playerPos);
  sys.update(1 / 60, ctx, playerPos);
  assert.deepEqual(calls, ["door-a"]);
});

test("nearestLockedHint：條件未達成且在提示半徑內回傳對應文字；達成後回傳 null", () => {
  const doorB = makeDoor("door-b", "area-clear:B", { x: 26, y: 0, z: -10 });
  const sys = new DoorSystem([doorB]);
  const nearPos = { x: 24, y: 0, z: -10 }; // 距門 2m，在 4.5m 提示半徑內

  const lockedHint = sys.nearestLockedHint(NEUTRAL_CTX, nearPos);
  assert.equal(lockedHint, "偵測到生命跡象，門鎖定中");

  const clearHint = sys.nearestLockedHint({ ...NEUTRAL_CTX, areaClearB: true }, nearPos);
  assert.equal(clearHint, null);
});

test("nearestLockedHint：超出提示半徑回傳 null", () => {
  const doorA = makeDoor("door-a", "has-weapon", { x: 0, y: 0, z: -4 });
  const sys = new DoorSystem([doorA]);
  const farPos = { x: 0, y: 0, z: 20 };
  assert.equal(sys.nearestLockedHint(NEUTRAL_CTX, farPos), null);
});

test("reset：所有門回到 closed／progress=0", () => {
  const doorA = makeDoor("door-a", "has-weapon", { x: 0, y: 0, z: -4 });
  const sys = new DoorSystem([doorA]);
  const ctx = { ...NEUTRAL_CTX, hasWeapon: true };
  const playerPos = { x: 0, y: 0, z: -3 };
  for (let i = 0; i < 10; i++) sys.update(1 / 60, ctx, playerPos);
  assert.equal(sys.get("door-a")!.status, "opening");

  sys.reset();
  assert.equal(sys.get("door-a")!.status, "closed");
  assert.equal(sys.get("door-a")!.progress, 0);
});
