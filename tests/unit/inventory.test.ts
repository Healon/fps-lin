// node:test 純邏輯單元測試：武器庫存（撿取前赤手空拳、給予自動裝備、未擁有不可切、
// 彈藥加值封頂、重置回到初始狀態）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { WeaponInventory } from "../../src/game/inventory.ts";
import { PULSE_PISTOL_MAGAZINE } from "../../src/game/weapons.ts";
import { SCATTER_MAGAZINE } from "../../src/game/shotgun.ts";

test("初始狀態：不擁有任何武器，current 為 null，彈藥回報 0", () => {
  const inv = new WeaponInventory();
  assert.equal(inv.owns("pistol"), false);
  assert.equal(inv.owns("shotgun"), false);
  assert.equal(inv.current, null);
  assert.equal(inv.ammo(), 0);
  assert.equal(inv.ownsAny(), false);
});

test("give('pistol')：擁有並自動裝備；重複 give 回傳 false 不重複觸發", () => {
  const inv = new WeaponInventory();
  assert.equal(inv.give("pistol"), true);
  assert.equal(inv.owns("pistol"), true);
  assert.equal(inv.current, "pistol");
  assert.equal(inv.ammo(), PULSE_PISTOL_MAGAZINE);
  assert.equal(inv.give("pistol"), false);
});

test("give('shotgun') 後自動切換裝備至散射槍（新武器自動上手）", () => {
  const inv = new WeaponInventory();
  inv.give("pistol");
  inv.give("shotgun");
  assert.equal(inv.current, "shotgun");
  assert.equal(inv.ammo(), SCATTER_MAGAZINE);
});

test("switchTo：未擁有的武器不可切（回傳 false，current 不變）", () => {
  const inv = new WeaponInventory();
  inv.give("pistol");
  assert.equal(inv.switchTo("shotgun"), false);
  assert.equal(inv.current, "pistol");
});

test("switchTo：擁有兩把武器可自由切換", () => {
  const inv = new WeaponInventory();
  inv.give("pistol");
  inv.give("shotgun"); // 自動切到 shotgun
  assert.equal(inv.switchTo("pistol"), true);
  assert.equal(inv.current, "pistol");
  assert.equal(inv.switchTo("shotgun"), true);
  assert.equal(inv.current, "shotgun");
});

test("addAmmo：彈藥加值封頂於彈藥上限，不溢出", () => {
  const inv = new WeaponInventory();
  inv.give("pistol");
  inv.pistol.ammo = PULSE_PISTOL_MAGAZINE - 5;
  inv.addAmmo("pistol", 30);
  assert.equal(inv.pistol.ammo, PULSE_PISTOL_MAGAZINE);
});

test("give('cannon')：擁有並自動裝備，彈藥回報上限（M3 第三階段新增）", () => {
  const inv = new WeaponInventory();
  assert.equal(inv.give("cannon"), true);
  assert.equal(inv.owns("cannon"), true);
  assert.equal(inv.current, "cannon");
  assert.equal(inv.ammo(), 12);
  assert.equal(inv.ownsAny(), true);
});

test("switchTo：離開能量砲時應中止其進行中的充能（不殘留，M3 第三階段新增）", () => {
  const inv = new WeaponInventory();
  inv.give("pistol");
  inv.give("cannon"); // 自動切到 cannon
  inv.cannon.chargeTick(0.5);
  assert.equal(inv.cannon.isCharging, true);
  inv.switchTo("pistol");
  assert.equal(inv.cannon.isCharging, false, "切離能量砲應中止充能");
  assert.equal(inv.cannon.chargeProgress, 0);
});

test("reset：清空擁有狀態與裝備，回到赤手空拳", () => {
  const inv = new WeaponInventory();
  inv.give("pistol");
  inv.give("shotgun");
  inv.reset();
  assert.equal(inv.owns("pistol"), false);
  assert.equal(inv.owns("shotgun"), false);
  assert.equal(inv.current, null);
  assert.equal(inv.pistol.ammo, PULSE_PISTOL_MAGAZINE);
  assert.equal(inv.shotgun.ammo, SCATTER_MAGAZINE);
});
