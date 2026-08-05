// node:test 純邏輯單元測試：守衛體 FSM 轉移表決定性、逐條轉移規則、數值鎖定、charge 觸發
// 與冷卻、方向性減傷角度邊界、hurt／dead。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transition,
  isFrontHit,
  Warden,
  WARDEN_MAX_HP,
  WARDEN_SPEED,
  WARDEN_MELEE_DAMAGE,
  WARDEN_MELEE_INTERVAL,
  WARDEN_CHARGE_SPEED,
  WARDEN_CHARGE_DURATION,
  WARDEN_CHARGE_WINDUP_DURATION,
  WARDEN_CHARGE_DAMAGE,
  WARDEN_CHARGE_COOLDOWN,
  WARDEN_CHARGE_MIN_RANGE,
  WARDEN_CHARGE_MAX_RANGE,
  WARDEN_FRONT_DAMAGE_MULTIPLIER,
  WARDEN_KNOCKBACK_DISTANCE,
  WARDEN_HALF,
} from "../../src/game/warden.ts";
import type { WardenState, WardenFsmContext } from "../../src/game/warden.ts";
import type { Vec3 } from "../../src/core/math.ts";

function ctx(overrides: Partial<WardenFsmContext> = {}): WardenFsmContext {
  return {
    distanceToPlayer: 100,
    hasLineOfSight: false,
    inAttackRange: false,
    stateTimer: 0,
    chargeReady: true,
    inChargeBand: false,
    ...overrides,
  };
}

test("transition 決定性：同一 (state, ctx) 輸入兩次呼叫回傳相同結果", () => {
  const states: WardenState[] = ["idle", "detect", "advance", "windup", "charge", "attack", "hurt", "dead"];
  const contexts: WardenFsmContext[] = [
    ctx(),
    ctx({ hasLineOfSight: true, distanceToPlayer: 5, inChargeBand: true }),
    ctx({ stateTimer: 10 }),
    ctx({ chargeReady: false }),
    ctx({ inAttackRange: true }),
  ];
  for (const s of states) {
    for (const c of contexts) {
      assert.equal(transition(s, c), transition(s, c), `state=${s} ctx=${JSON.stringify(c)}`);
    }
  }
});

test("idle：視線內且在偵測距離內 → detect；否則停留 idle", () => {
  assert.equal(transition("idle", ctx({ hasLineOfSight: true, distanceToPlayer: 8 })), "detect");
  assert.equal(transition("idle", ctx({ hasLineOfSight: false, distanceToPlayer: 8 })), "idle");
  assert.equal(transition("idle", ctx({ hasLineOfSight: true, distanceToPlayer: 999 })), "idle");
});

test("detect：進攻擊範圍立即 attack；停留達反應時間 → advance；失去視線／距離過遠 → idle", () => {
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 1, inAttackRange: true })), "attack");
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 8, stateTimer: 0.5 })), "advance");
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 8, stateTimer: 0.05 })), "detect");
  assert.equal(transition("detect", ctx({ hasLineOfSight: false, distanceToPlayer: 8 })), "idle");
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 999 })), "idle");
});

test("advance：在衝撞觸發帶內且視線清楚且冷卻完成 → windup；進攻擊範圍 → attack；追丟 → idle；否則停留 advance", () => {
  assert.equal(
    transition("advance", ctx({ hasLineOfSight: true, chargeReady: true, inChargeBand: true, distanceToPlayer: WARDEN_CHARGE_MIN_RANGE })),
    "windup",
  );
  assert.equal(
    transition("advance", ctx({ hasLineOfSight: true, chargeReady: true, inChargeBand: true, distanceToPlayer: WARDEN_CHARGE_MAX_RANGE })),
    "windup",
  );
  assert.equal(
    transition("advance", ctx({ hasLineOfSight: true, chargeReady: false, inChargeBand: true, distanceToPlayer: 5 })),
    "advance",
    "冷卻未完成不應蓄力",
  );
  assert.equal(
    transition("advance", ctx({ hasLineOfSight: false, chargeReady: true, inChargeBand: true, distanceToPlayer: 5 })),
    "advance",
    "無視線不應蓄力",
  );
  assert.equal(transition("advance", ctx({ inAttackRange: true, distanceToPlayer: 1 })), "attack");
  assert.equal(transition("advance", ctx({ distanceToPlayer: 999 })), "idle", "超過放棄距離應回 idle");
  assert.equal(transition("advance", ctx({ hasLineOfSight: true, distanceToPlayer: 8 })), "advance", "距離帶外應持續逼近");
});

test("windup：時間到 → charge；失去視線或距離過遠中止 → advance；否則停留 windup", () => {
  assert.equal(transition("windup", ctx({ hasLineOfSight: true, distanceToPlayer: 5, stateTimer: WARDEN_CHARGE_WINDUP_DURATION })), "charge");
  assert.equal(transition("windup", ctx({ hasLineOfSight: true, distanceToPlayer: 5, stateTimer: 0.1 })), "windup");
  assert.equal(transition("windup", ctx({ hasLineOfSight: false, distanceToPlayer: 5, stateTimer: 0.1 })), "advance", "蓄力中失去視線應中止");
  assert.equal(transition("windup", ctx({ hasLineOfSight: true, distanceToPlayer: 999, stateTimer: 0.1 })), "advance", "蓄力中目標跑遠應中止");
});

test("charge：時間到（未命中）→ advance；否則停留 charge（命中提前結束由 update() 直接指定，不經本函式）", () => {
  assert.equal(transition("charge", ctx({ stateTimer: WARDEN_CHARGE_DURATION })), "advance");
  assert.equal(transition("charge", ctx({ stateTimer: 0.1 })), "charge");
});

test("attack：仍在範圍內持續 attack；離開範圍 → advance", () => {
  assert.equal(transition("attack", ctx({ inAttackRange: true })), "attack");
  assert.equal(transition("attack", ctx({ inAttackRange: false })), "advance");
});

test("hurt：硬直時間未到停留 hurt，時間到轉 advance", () => {
  assert.equal(transition("hurt", ctx({ stateTimer: 0.05 })), "hurt");
  assert.equal(transition("hurt", ctx({ stateTimer: 0.2 })), "advance");
});

test("dead 為終態，任何情境皆回傳 dead", () => {
  assert.equal(transition("dead", ctx({ hasLineOfSight: true })), "dead");
  assert.equal(transition("dead", ctx()), "dead");
});

test("規格鎖定：守衛體數值必須符合 PLAN §3.4 與本次派工規格（改規格請同步改 PLAN 與本測試）", () => {
  assert.equal(WARDEN_MAX_HP, 160);
  assert.equal(WARDEN_SPEED, 1.8);
  assert.equal(WARDEN_MELEE_DAMAGE, 25);
  assert.equal(WARDEN_MELEE_INTERVAL, 1.2);
  assert.equal(WARDEN_CHARGE_SPEED, 6);
  assert.equal(WARDEN_CHARGE_DURATION, 1);
  assert.equal(WARDEN_CHARGE_WINDUP_DURATION, 0.5);
  assert.equal(WARDEN_CHARGE_DAMAGE, 25);
  assert.equal(WARDEN_CHARGE_COOLDOWN, 4);
  assert.equal(WARDEN_CHARGE_MIN_RANGE, 4);
  assert.equal(WARDEN_CHARGE_MAX_RANGE, 7);
  assert.equal(WARDEN_FRONT_DAMAGE_MULTIPLIER, 0.5);
  assert.equal(WARDEN_KNOCKBACK_DISTANCE, 1.2);
  assert.deepEqual(WARDEN_HALF, { x: 0.6, y: 1.0, z: 0.55 });
});

// ---- 方向性減傷角度邊界（AC 要求：unit 測試鎖住正面半傷、背面全額的角度邊界）----

/** 以 facingYaw=0（forward=(0,0,-1)）為基準：angleDeg=0 時 hitDirection 為攻擊者正前方
 *  射來（dot(hitDirection,forward)=-1，最正面）；angleDeg 越大越偏向側面／背面。 */
function hitDirAtAngleFromFront(angleDeg: number): Vec3 {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(rad), y: 0, z: Math.cos(rad) };
}

test("isFrontHit：facingYaw=0 時，正面（0 度）判 true，背面（180 度）判 false", () => {
  assert.equal(isFrontHit(hitDirAtAngleFromFront(0), 0), true);
  assert.equal(isFrontHit(hitDirAtAngleFromFront(180), 0), false);
});

test("isFrontHit：角度邊界鎖定——59 度判 true（正面弧內），61 度判 false（正面弧外）", () => {
  assert.equal(isFrontHit(hitDirAtAngleFromFront(59), 0), true, "59 度應在 60 度正面弧內");
  assert.equal(isFrontHit(hitDirAtAngleFromFront(61), 0), false, "61 度應在 60 度正面弧外");
});

test("isFrontHit：恰好 60 度（邊界本身）判 false（規格為「小於」60 度才算正面）", () => {
  assert.equal(isFrontHit(hitDirAtAngleFromFront(60), 0), false);
});

test("isFrontHit：facingYaw 非 0（90 度）時正確隨面向旋轉判定", () => {
  const yaw = Math.PI / 2; // forward = (-1, 0)
  assert.equal(isFrontHit({ x: 1, y: 0, z: 0 }, yaw), true, "攻擊者在守衛體面向方向（-X）上，命中方向 +X 應判正面");
  assert.equal(isFrontHit({ x: -1, y: 0, z: 0 }, yaw), false, "攻擊者在守衛體背後，應判背面");
});

test("Warden.applyDamage：正面命中傷害減半，背面命中全額，未提供方向視為全額", () => {
  const w = new Warden(0, { x: 0, y: 0, z: 0 }); // facingYaw 預設 0
  const frontDir = hitDirAtAngleFromFront(0);
  const died1 = w.applyDamage(40, frontDir);
  assert.equal(died1, false);
  assert.equal(w.hp, WARDEN_MAX_HP - 20, "正面命中應僅扣半額（40 * 0.5 = 20）");

  const backDir = hitDirAtAngleFromFront(180);
  w.applyDamage(40, backDir);
  assert.equal(w.hp, WARDEN_MAX_HP - 20 - 40, "背面命中應扣全額");

  const hpBeforeNoDir = w.hp;
  w.applyDamage(10);
  assert.equal(w.hp, hpBeforeNoDir - 10, "未提供 hitDirection 應視為全額傷害");
});

test("Warden.applyDamage：致命傷害轉 dead 且 HP 不為負，已死亡不再受傷", () => {
  const w = new Warden(0, { x: 0, y: 0, z: 0 });
  const died = w.applyDamage(999999);
  assert.equal(died, true);
  assert.equal(w.state, "dead");
  assert.equal(w.hp, 0);
  const died2 = w.applyDamage(10);
  assert.equal(died2, false, "已死亡不應再受傷害");
});

test("Warden.removable：死亡瞬間 false，溶解動畫播完後 true", () => {
  const w = new Warden(0, { x: 0, y: 0, z: 0 });
  w.applyDamage(999999);
  assert.equal(w.removable, false);
  w.update(1.5, { x: 0, y: 0, z: 0 }, { x: 0, y: 1.7, z: 0 }, []);
  assert.equal(w.removable, true);
});

test("Warden：在衝撞觸發帶內、視線清楚、無遮蔽時，經過反應與蓄力時間後應觸發一次衝撞（charge）", () => {
  const w = new Warden(0, { x: 0, y: 0, z: 0 });
  const playerFeet = { x: 5, y: 0, z: 0 }; // 距離 5m，落在 4~7m 觸發帶
  const playerEye = { x: 5, y: 1.7, z: 0 };
  let sawCharge = false;
  for (let i = 0; i < 120 && !sawCharge; i++) {
    w.update(1 / 60, playerFeet, playerEye, []);
    if (w.state === "charge") sawCharge = true;
  }
  assert.ok(sawCharge, "應在數幀內進入 charge 狀態");
});

test("Warden：衝撞命中玩家（站立於觸發帶內）應觸發一次傷害事件並附帶擊退向量，隨後提前回到 advance", () => {
  const w = new Warden(0, { x: 0, y: 0, z: 0 });
  // 站在觸發帶中段（5m，留有餘裕，避開邊界——貼著 4m 邊界站會被 advance 逼近的第一幀
  // 些微推出帶外，見上方「在衝撞觸發帶內…應觸發一次衝撞」測試的同款座標選擇）。
  const playerFeet = { x: 5, y: 0, z: 0 };
  const playerEye = { x: 5, y: 1.7, z: 0 };
  let hitEvent = null as ReturnType<Warden["update"]>;
  for (let i = 0; i < 300 && !hitEvent; i++) {
    const evt = w.update(1 / 60, playerFeet, playerEye, []);
    if (evt && evt.damage === WARDEN_CHARGE_DAMAGE) hitEvent = evt;
  }
  assert.ok(hitEvent, "衝撞應命中玩家並回傳傷害事件");
  assert.equal(hitEvent!.damage, WARDEN_CHARGE_DAMAGE);
  assert.ok(hitEvent!.knockback !== null, "衝撞命中應附帶擊退向量");
  const kb = hitEvent!.knockback!;
  const kbLen = Math.hypot(kb.x, kb.y, kb.z);
  assert.ok(Math.abs(kbLen - WARDEN_KNOCKBACK_DISTANCE) < 1e-6, `擊退距離應為 ${WARDEN_KNOCKBACK_DISTANCE}m，實際 ${kbLen}`);
});

test("Warden：近戰攻擊（進入 attack 範圍）應每 WARDEN_MELEE_INTERVAL 秒觸發一次、無擊退", () => {
  const w = new Warden(0, { x: 0, y: 0, z: 0 });
  const playerFeet = { x: 1, y: 0, z: 0 }; // 距離 1m，在 attack 範圍內
  const playerEye = { x: 1, y: 1.7, z: 0 };
  let hitCount = 0;
  let lastEvent: ReturnType<Warden["update"]> = null;
  for (let i = 0; i < 240; i++) {
    const evt = w.update(1 / 60, playerFeet, playerEye, []);
    if (evt) {
      hitCount++;
      lastEvent = evt;
    }
  }
  assert.ok(hitCount >= 2, `4 秒內應觸發至少 2 次近戰攻擊（間隔 ${WARDEN_MELEE_INTERVAL}s），實際 ${hitCount} 次`);
  assert.equal(lastEvent?.damage, WARDEN_MELEE_DAMAGE);
  assert.equal(lastEvent?.knockback, null, "一般近戰攻擊不應有擊退");
});

test("Warden FSM 與移動軌跡皆決定性：相同輸入序列兩次獨立模擬結果逐位元相同", () => {
  const runTrajectory = (): { x: number; y: number; z: number; state: string }[] => {
    const w = new Warden(2, { x: 0, y: 0, z: 0 });
    const trail: { x: number; y: number; z: number; state: string }[] = [];
    for (let i = 0; i < 300; i++) {
      w.update(1 / 60, { x: 5, y: 0, z: 2 }, { x: 5, y: 1.7, z: 2 }, []);
      trail.push({ x: w.position.x, y: w.position.y, z: w.position.z, state: w.state });
    }
    return trail;
  };
  const a = runTrajectory();
  const b = runTrajectory();
  assert.deepEqual(a, b);
});
