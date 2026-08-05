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

const NEUTRAL_CTX = { hasWeapon: false, areaClearB: false, areaClearC: false, consoleActivated: false, areaClearE: false };

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

test("console-activated 條件：未啟動時鎖定，啟動後可觸發滑開（M3 新增）", () => {
  const doorD = makeDoor("door-d", "console-activated", { x: 62, y: 0, z: -10 });
  const sys = new DoorSystem([doorD]);
  const playerPos = { x: 62, y: 0, z: -9 }; // 距門 1m，在 2m 觸發半徑內

  sys.update(1 / 60, NEUTRAL_CTX, playerPos);
  assert.equal(sys.get("door-d")!.status, "closed", "控制台未啟動前應鎖定");

  sys.update(1 / 60, { ...NEUTRAL_CTX, consoleActivated: true }, playerPos);
  assert.equal(sys.get("door-d")!.status, "opening", "控制台啟動後應開始滑開");
});

test("area-clear:E 條件：未清空時鎖定，清空後可觸發滑開（M3 第二階段新增）", () => {
  const doorE = makeDoor("door-e", "area-clear:E", { x: 86, y: 0, z: -10 });
  const sys = new DoorSystem([doorE]);
  const playerPos = { x: 86, y: 0, z: -9 }; // 距門 1m，在 2m 觸發半徑內

  sys.update(1 / 60, NEUTRAL_CTX, playerPos);
  assert.equal(sys.get("door-e")!.status, "closed", "區域 E 未清空前應鎖定");

  sys.update(1 / 60, { ...NEUTRAL_CTX, areaClearE: true }, playerPos);
  assert.equal(sys.get("door-e")!.status, "opening", "區域 E 清空後應開始滑開");
});

test("none 條件：恆真，玩家靠近即開（M3 第三階段新增，首領戰大門）", () => {
  const doorF = makeDoor("door-f", "none", { x: 98, y: 0, z: -10 });
  const sys = new DoorSystem([doorF]);
  const playerPos = { x: 98, y: 0, z: -9 }; // 距門 1m，在 2m 觸發半徑內
  sys.update(1 / 60, NEUTRAL_CTX, playerPos);
  assert.equal(sys.get("door-f")!.status, "opening", "none 條件應恆真，走近即開");
});

test("lock：永久鎖定門，強制回到 closed 且此後 update() 完全不再評估（不論條件或距離）", () => {
  const doorF = makeDoor("door-f", "none", { x: 98, y: 0, z: -10 });
  const sys = new DoorSystem([doorF]);
  const nearPos = { x: 98, y: 0, z: -9 };

  // 先讓門開啟。
  for (let i = 0; i < Math.ceil(DOOR_SLIDE_DURATION * 60) + 5; i++) sys.update(1 / 60, NEUTRAL_CTX, nearPos);
  assert.equal(sys.get("door-f")!.status, "open");

  sys.lock("door-f");
  assert.equal(sys.get("door-f")!.status, "closed", "lock() 應立即強制回到 closed");
  assert.equal(sys.get("door-f")!.progress, 0);
  assert.equal(sys.activeColliders().length, 1, "鎖定後碰撞體應恢復生效");

  // 此後即使玩家持續在觸發半徑內、條件恆真，門也不應再開啟（永久鎖定）。
  for (let i = 0; i < 200; i++) sys.update(1 / 60, NEUTRAL_CTX, nearPos);
  assert.equal(sys.get("door-f")!.status, "closed", "鎖定後不應再滑開");
  assert.equal(sys.get("door-f")!.progress, 0);
});

test("lock：查無此門 id 時無動作，不拋錯", () => {
  const doorA = makeDoor("door-a", "has-weapon", { x: 0, y: 0, z: -4 });
  const sys = new DoorSystem([doorA]);
  assert.doesNotThrow(() => sys.lock("door-nonexistent"));
});

test("reset：連 locked 門也回到 closed／progress=0 且解除鎖定（供死亡重生／重新開始使用）", () => {
  const doorF = makeDoor("door-f", "none", { x: 98, y: 0, z: -10 });
  const sys = new DoorSystem([doorF]);
  sys.lock("door-f");
  sys.reset();
  assert.equal(sys.get("door-f")!.status, "closed");
  assert.equal(sys.get("door-f")!.progress, 0);
  // 解除鎖定後應可再次正常開啟（none 條件恆真，走近即開）。
  sys.update(1 / 60, NEUTRAL_CTX, { x: 98, y: 0, z: -9 });
  assert.equal(sys.get("door-f")!.status, "opening", "reset 後應解除 locked，可再次正常評估");
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
