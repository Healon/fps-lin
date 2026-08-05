// node:test 純邏輯單元測試：射擊體 FSM 轉移表決定性、逐條轉移規則、數值鎖定、windup 觸發
// shoot 事件、hurt／dead。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transition,
  Spitter,
  SPITTER_MAX_HP,
  SPITTER_SPEED,
  SPITTER_PROJECTILE_DAMAGE,
  SPITTER_ATTACK_INTERVAL,
  SPITTER_PROJECTILE_SPEED,
  SPITTER_WINDUP_DURATION,
  SPITTER_MIN_KEEP_DISTANCE,
  SPITTER_MAX_KEEP_DISTANCE,
  SPITTER_HALF,
} from "../../src/game/spitter.ts";
import type { SpitterState, SpitterFsmContext } from "../../src/game/spitter.ts";

function ctx(overrides: Partial<SpitterFsmContext> = {}): SpitterFsmContext {
  return {
    distanceToPlayer: 100,
    hasLineOfSight: false,
    stateTimer: 0,
    attackReady: true,
    ...overrides,
  };
}

test("transition 決定性：同一 (state, ctx) 輸入兩次呼叫回傳相同結果", () => {
  const states: SpitterState[] = ["idle", "detect", "reposition", "windup", "shoot", "hurt", "dead"];
  const contexts: SpitterFsmContext[] = [
    ctx(),
    ctx({ hasLineOfSight: true, distanceToPlayer: 8 }),
    ctx({ stateTimer: 10 }),
    ctx({ attackReady: false }),
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

test("detect：停留達反應時間 → reposition；失去視線／距離過遠 → idle", () => {
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 8, stateTimer: 0.5 })), "reposition");
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 8, stateTimer: 0.05 })), "detect");
  assert.equal(transition("detect", ctx({ hasLineOfSight: false, distanceToPlayer: 8 })), "idle");
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 999 })), "idle");
});

test("reposition：在中距帶內且視線清楚且攻擊冷卻完成 → windup；否則停留 reposition；追丟 → idle", () => {
  assert.equal(
    transition("reposition", ctx({ hasLineOfSight: true, attackReady: true, distanceToPlayer: SPITTER_MIN_KEEP_DISTANCE })),
    "windup",
  );
  assert.equal(
    transition("reposition", ctx({ hasLineOfSight: true, attackReady: true, distanceToPlayer: SPITTER_MAX_KEEP_DISTANCE })),
    "windup",
  );
  assert.equal(transition("reposition", ctx({ hasLineOfSight: true, attackReady: false, distanceToPlayer: 8 })), "reposition", "冷卻未完成不應蓄力");
  assert.equal(transition("reposition", ctx({ hasLineOfSight: false, attackReady: true, distanceToPlayer: 8 })), "reposition", "無視線不應蓄力");
  assert.equal(transition("reposition", ctx({ hasLineOfSight: true, attackReady: true, distanceToPlayer: 3 })), "reposition", "距離太近（<最小值）不應蓄力");
  assert.equal(transition("reposition", ctx({ hasLineOfSight: true, attackReady: true, distanceToPlayer: 15 })), "reposition", "距離太遠（>最大值）不應蓄力");
  assert.equal(transition("reposition", ctx({ distanceToPlayer: 999 })), "idle", "超過放棄距離應回 idle");
});

test("windup：時間到 → shoot；失去視線或距離過遠中止 → reposition；否則停留 windup", () => {
  assert.equal(transition("windup", ctx({ hasLineOfSight: true, distanceToPlayer: 8, stateTimer: SPITTER_WINDUP_DURATION })), "shoot");
  assert.equal(transition("windup", ctx({ hasLineOfSight: true, distanceToPlayer: 8, stateTimer: 0.1 })), "windup");
  assert.equal(transition("windup", ctx({ hasLineOfSight: false, distanceToPlayer: 8, stateTimer: 0.1 })), "reposition", "蓄力中失去視線應中止");
  assert.equal(transition("windup", ctx({ hasLineOfSight: true, distanceToPlayer: 999, stateTimer: 0.1 })), "reposition", "蓄力中目標跑遠應中止");
});

test("shoot：單幀狀態，恆回 reposition", () => {
  assert.equal(transition("shoot", ctx()), "reposition");
  assert.equal(transition("shoot", ctx({ hasLineOfSight: true, distanceToPlayer: 1 })), "reposition");
});

test("hurt：硬直時間未到停留 hurt，時間到轉 reposition", () => {
  assert.equal(transition("hurt", ctx({ stateTimer: 0.1 })), "hurt");
  assert.equal(transition("hurt", ctx({ stateTimer: 0.3 })), "reposition");
});

test("dead 為終態，任何情境皆回傳 dead", () => {
  assert.equal(transition("dead", ctx({ hasLineOfSight: true })), "dead");
  assert.equal(transition("dead", ctx()), "dead");
});

test("規格鎖定：射擊體數值必須符合 PLAN §3.4（改規格請同步改 PLAN 與本測試）", () => {
  assert.equal(SPITTER_MAX_HP, 45);
  assert.equal(SPITTER_SPEED, 3.0);
  assert.equal(SPITTER_PROJECTILE_DAMAGE, 8);
  assert.equal(SPITTER_ATTACK_INTERVAL, 1.5);
  assert.equal(SPITTER_PROJECTILE_SPEED, 12);
  assert.equal(SPITTER_WINDUP_DURATION, 0.4);
  assert.equal(SPITTER_MIN_KEEP_DISTANCE, 6);
  assert.equal(SPITTER_MAX_KEEP_DISTANCE, 10);
  assert.deepEqual(SPITTER_HALF, { x: 0.32, y: 0.95, z: 0.38 });
});

test("Spitter.applyDamage：非致命傷害轉 hurt，致命傷害轉 dead 且 HP 不為負", () => {
  const s = new Spitter(0, { x: 0, y: 0, z: 0 });
  const died1 = s.applyDamage(20);
  assert.equal(died1, false);
  assert.equal(s.state, "hurt");
  assert.equal(s.hp, 25);

  const died2 = s.applyDamage(100);
  assert.equal(died2, true);
  assert.equal(s.state, "dead");
  assert.equal(s.hp, 0);

  const died3 = s.applyDamage(10);
  assert.equal(died3, false, "已死亡不應再受傷害");
});

test("Spitter.removable：死亡瞬間 false，溶解動畫播完後 true", () => {
  const s = new Spitter(0, { x: 0, y: 0, z: 0 });
  s.applyDamage(1000);
  assert.equal(s.removable, false);
  s.update(1.3, { x: 0, y: 0, z: 0 }, { x: 0, y: 1.7, z: 0 }, []);
  assert.equal(s.removable, true);
});

test("Spitter：在中距帶內、視線清楚、無遮蔽時，經過偵測反應與蓄力時間後應觸發一次 shoot 事件", () => {
  const s = new Spitter(0, { x: 0, y: 0, z: 0 });
  const playerFeet = { x: 8, y: 0, z: 0 }; // 距離 8m，落在 6~10m 中距帶
  const playerEye = { x: 8, y: 1.7, z: 0 };
  let shootEvent = null as ReturnType<Spitter["update"]>;
  for (let i = 0; i < 120 && !shootEvent; i++) {
    shootEvent = s.update(1 / 60, playerFeet, playerEye, []);
  }
  assert.ok(shootEvent, "應在數幀內觸發一次發射事件");
  assert.equal(shootEvent?.damage, SPITTER_PROJECTILE_DAMAGE);
  assert.ok(Math.abs(Math.hypot(shootEvent!.dir.x, shootEvent!.dir.y, shootEvent!.dir.z) - 1) < 1e-6, "方向應為單位向量");
  // "shoot" 為單幀狀態：觸發事件當幀 state 即為 "shoot"，下一幀 transition() 才轉回 reposition
  // （同 transition() 純函式測試「shoot 恆回 reposition」的語意，見上方 shoot 轉移測試）。
  assert.equal(s.state, "shoot", "觸發事件當幀 state 應為 shoot");
  s.update(1 / 60, playerFeet, playerEye, []);
  assert.equal(s.state, "reposition", "下一幀應轉回 reposition");
});

test("Spitter：近身（<最小距離）時應朝反方向後退拉開距離", () => {
  const s = new Spitter(0, { x: 0, y: 0, z: 0 });
  const playerFeet = { x: 2, y: 0, z: 0 }; // 距離 2m，小於最小距離 6m
  const playerEye = { x: 2, y: 1.7, z: 0 };
  for (let i = 0; i < 30; i++) s.update(1 / 60, playerFeet, playerEye, []);
  assert.equal(s.state, "reposition");
  assert.ok(s.position.x < 0, `應朝反方向（-x）後退，實際 x=${s.position.x}`);
});

test("Spitter FSM 與投射軌跡皆決定性：相同輸入序列兩次獨立模擬結果逐位元相同", () => {
  const runTrajectory = (): { x: number; y: number; z: number; state: string }[] => {
    const s = new Spitter(3, { x: 0, y: 0, z: 0 });
    const trail: { x: number; y: number; z: number; state: string }[] = [];
    for (let i = 0; i < 200; i++) {
      s.update(1 / 60, { x: 8, y: 0, z: 3 }, { x: 8, y: 1.7, z: 3 }, []);
      trail.push({ x: s.position.x, y: s.position.y, z: s.position.z, state: s.state });
    }
    return trail;
  };
  const a = runTrajectory();
  const b = runTrajectory();
  assert.deepEqual(a, b);
});
