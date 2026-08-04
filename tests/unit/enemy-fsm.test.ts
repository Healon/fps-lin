// node:test 純邏輯單元測試：巡行體 FSM 轉移表決定性（同輸入必同輸出）與逐條轉移規則，
// 含 v4 去磁鐵化的 retreat 狀態（PLAN §3.4 v4）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transition,
  Crawler,
  CRAWLER_MAX_HP,
  CRAWLER_SPEED,
  CRAWLER_MELEE_DAMAGE,
  CRAWLER_ATTACK_INTERVAL,
  CRAWLER_HALF,
  RETREAT_DURATION,
  RETREAT_SPEED,
  CHASE_DRIFT_MAX_RADIANS,
} from "../../src/game/enemy.ts";
import type { EnemyState, FsmContext } from "../../src/game/enemy.ts";

function ctx(overrides: Partial<FsmContext> = {}): FsmContext {
  return {
    distanceToPlayer: 100,
    hasLineOfSight: false,
    inAttackRange: false,
    stateTimer: 0,
    ...overrides,
  };
}

function horizontalDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

test("transition 決定性：同一 (state, ctx) 輸入兩次呼叫回傳相同結果", () => {
  const states: EnemyState[] = ["idle", "detect", "chase", "attack", "retreat", "hurt", "dead"];
  const contexts: FsmContext[] = [
    ctx(),
    ctx({ hasLineOfSight: true, distanceToPlayer: 5 }),
    ctx({ inAttackRange: true, distanceToPlayer: 1 }),
    ctx({ stateTimer: 10 }),
  ];
  for (const s of states) {
    for (const c of contexts) {
      assert.equal(transition(s, c), transition(s, c), `state=${s} ctx=${JSON.stringify(c)}`);
    }
  }
});

test("idle：視線內且在偵測距離內 → detect；否則停留 idle", () => {
  assert.equal(transition("idle", ctx({ hasLineOfSight: true, distanceToPlayer: 5 })), "detect");
  assert.equal(transition("idle", ctx({ hasLineOfSight: false, distanceToPlayer: 5 })), "idle");
  assert.equal(transition("idle", ctx({ hasLineOfSight: true, distanceToPlayer: 999 })), "idle");
});

test("detect：進入攻擊範圍 → attack；停留達反應時間 → chase；失去視線／距離過遠 → idle", () => {
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, inAttackRange: true, distanceToPlayer: 1 })), "attack");
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 5, stateTimer: 0.5 })), "chase");
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 5, stateTimer: 0.05 })), "detect");
  assert.equal(transition("detect", ctx({ hasLineOfSight: false, distanceToPlayer: 5 })), "idle");
  assert.equal(transition("detect", ctx({ hasLineOfSight: true, distanceToPlayer: 999 })), "idle");
});

test("chase：進入攻擊範圍 → attack；追丟（超過放棄距離）→ idle；否則停留 chase", () => {
  assert.equal(transition("chase", ctx({ inAttackRange: true, distanceToPlayer: 1 })), "attack");
  assert.equal(transition("chase", ctx({ distanceToPlayer: 999 })), "idle");
  assert.equal(transition("chase", ctx({ distanceToPlayer: 6 })), "chase");
});

test("attack：脫離攻擊範圍 → chase；否則停留 attack（進 retreat 由 Crawler.update() 命中事件直接指定，見下方整合測試）", () => {
  assert.equal(transition("attack", ctx({ inAttackRange: false, distanceToPlayer: 5 })), "chase");
  assert.equal(transition("attack", ctx({ inAttackRange: true, distanceToPlayer: 1 })), "attack");
});

test("retreat：後撤時間未到停留 retreat，時間到轉 chase（不重新經過 detect）", () => {
  assert.equal(transition("retreat", ctx({ stateTimer: 0.5 })), "retreat");
  assert.equal(transition("retreat", ctx({ stateTimer: RETREAT_DURATION })), "chase");
  // 即使此時仍在攻擊範圍內，retreat 結束一律先回 chase，不直接跳回 attack（避免立即重新黏身）。
  assert.equal(transition("retreat", ctx({ stateTimer: RETREAT_DURATION, inAttackRange: true, distanceToPlayer: 0.5 })), "chase");
});

test("hurt：硬直時間未到停留 hurt，時間到轉 chase", () => {
  assert.equal(transition("hurt", ctx({ stateTimer: 0.1 })), "hurt");
  assert.equal(transition("hurt", ctx({ stateTimer: 0.3 })), "chase");
});

test("dead 為終態，任何情境皆回傳 dead", () => {
  assert.equal(transition("dead", ctx({ hasLineOfSight: true, inAttackRange: true })), "dead");
  assert.equal(transition("dead", ctx()), "dead");
});

test("Crawler.applyDamage：非致命傷害轉 hurt 且回傳 false，HP 正確扣減", () => {
  const c = new Crawler(0, { x: 0, y: 0, z: 0 });
  const died = c.applyDamage(12);
  assert.equal(died, false);
  assert.equal(c.state, "hurt");
  assert.equal(c.hp, CRAWLER_MAX_HP - 12);
});

test("Crawler.applyDamage：致命傷害轉 dead 且回傳 true，HP 不為負", () => {
  const c = new Crawler(0, { x: 0, y: 0, z: 0 });
  c.applyDamage(20);
  const died = c.applyDamage(20);
  assert.equal(died, true);
  assert.equal(c.state, "dead");
  assert.equal(c.hp, 0);
});

test("Crawler.applyDamage：已死亡的敵人再受傷無效（回傳 false，不重複觸發死亡）", () => {
  const c = new Crawler(0, { x: 0, y: 0, z: 0 });
  c.applyDamage(100);
  assert.equal(c.state, "dead");
  const secondHit = c.applyDamage(100);
  assert.equal(secondHit, false);
  assert.equal(c.hp, 0);
});

test("Crawler.removable：死亡瞬間為 false，溶解動畫播完後為 true", () => {
  const c = new Crawler(0, { x: 0, y: 0, z: 0 });
  c.applyDamage(100);
  assert.equal(c.removable, false);
  c.update(1.3, { x: 0, y: 0, z: 0 }, { x: 0, y: 1.7, z: 0 }, []);
  assert.equal(c.removable, true);
});

test("Crawler.update：追擊中會朝玩家水平方向移動（無碰撞阻擋時，含橫向漂移仍淨朝玩家前進）", () => {
  const c = new Crawler(0, { x: 0, y: 0, z: 0 });
  // 強制進入 chase：先以極近距離觸發 detect→chase 需要時間，改為直接多次 update 模擬。
  const playerFeet = { x: 5, y: 0, z: 0 };
  const playerEye = { x: 5, y: 1.7, z: 0 };
  for (let i = 0; i < 60; i++) {
    c.update(1 / 60, playerFeet, playerEye, []);
  }
  assert.ok(c.state === "chase" || c.state === "attack", `state=${c.state}`);
  assert.ok(c.position.x > 0, `應朝玩家方向（+x）移動，實際 x=${c.position.x}`);
});

test("Crawler：攻擊命中後直接轉 retreat（不經過 transition() 的 attack 分支）並持續遠離玩家", () => {
  const c = new Crawler(0, { x: 0, y: 0, z: 0 });
  // 玩家就站在攻擊範圍內（<1.5m），敵人應快速 idle→detect→attack 並在命中當幀轉 retreat。
  const playerFeet = { x: 1.0, y: 0, z: 0 };
  const playerEye = { x: 1.0, y: 1.7, z: 0 };

  let attackEvent = null as ReturnType<Crawler["update"]>;
  for (let i = 0; i < 30 && !attackEvent; i++) {
    attackEvent = c.update(1 / 60, playerFeet, playerEye, []);
  }
  assert.ok(attackEvent, "應在數幀內觸發至少一次近戰攻擊");
  assert.equal(attackEvent?.damage, CRAWLER_MELEE_DAMAGE);
  assert.equal(c.state, "retreat", "攻擊命中後應立即轉入 retreat，不黏身");

  const distanceAfterHit = horizontalDistance(c.position, playerFeet);
  c.update(0.2, playerFeet, playerEye, []);
  const distanceMidRetreat = horizontalDistance(c.position, playerFeet);
  assert.ok(distanceMidRetreat > distanceAfterHit, "後撤期間應持續遠離玩家（背向玩家後撤）");

  // 後撤時間到（RETREAT_DURATION）應回 chase，不重新經過 detect。
  let sawChase = false;
  for (let i = 0; i < 120; i++) {
    c.update(1 / 60, playerFeet, playerEye, []);
    if (c.state !== "retreat") {
      sawChase = c.state === "chase";
      break;
    }
  }
  assert.ok(sawChase, `後撤結束應回 chase，實際 state=${c.state}`);
});

test("chase 橫向漂移為決定性：相同 id 與相同輸入序列，兩次獨立模擬得到逐位元相同的位置軌跡", () => {
  const runTrajectory = (): Vec3Like[] => {
    const c = new Crawler(7, { x: 0, y: 0, z: 0 });
    const trail: Vec3Like[] = [];
    for (let i = 0; i < 120; i++) {
      c.update(1 / 60, { x: 6, y: 0, z: 2 }, { x: 6, y: 1.7, z: 2 }, []);
      trail.push({ x: c.position.x, y: c.position.y, z: c.position.z });
    }
    return trail;
  };
  interface Vec3Like {
    x: number;
    y: number;
    z: number;
  }
  const a = runTrajectory();
  const b = runTrajectory();
  assert.deepEqual(a, b);
});

test("規格鎖定：巡行體數值必須符合 PLAN §3.4 v4（改規格請同步改 PLAN 與本測試）", () => {
  assert.equal(CRAWLER_MAX_HP, 24, "PLAN §3.4 v4：HP 24，手槍 12 傷兩發擊殺");
  assert.equal(CRAWLER_SPEED, 2.2, "PLAN §3.4 v4：殭屍蹣跚速度 2.2 m/s");
  assert.equal(CRAWLER_MELEE_DAMAGE, 10);
  assert.equal(CRAWLER_ATTACK_INTERVAL, 0.8);
  assert.ok(RETREAT_DURATION >= 1.0 && RETREAT_DURATION <= 1.5, "後撤時長需落在 1.0～1.5 秒");
  assert.ok(RETREAT_SPEED > 0 && RETREAT_SPEED < CRAWLER_SPEED * 2, "後撤速度需為合理正值");
  assert.ok(Math.abs(CHASE_DRIFT_MAX_RADIANS - (35 * Math.PI) / 180) < 1e-9, "橫向漂移最大偏擺角約 ±35 度");
  assert.deepEqual(CRAWLER_HALF, { x: 0.35, y: 0.85, z: 0.42 }, "PLAN §3.4 v4：胸口正對準星高度，站立總高約 1.7m；水平尺寸涵蓋視覺旋轉包絡");
});

test("受擊回饋：applyDamage 非致命命中觸發 hitFlashIntensity=1，隨時間衰減至 0", () => {
  const c = new Crawler(0, { x: 0, y: 0, z: 0 });
  c.applyDamage(12); // 24 HP，12 傷非致命 → hurt
  assert.equal(c.hitFlashIntensity, 1);
  c.update(0.1, { x: 0, y: 0, z: 0 }, { x: 0, y: 1.7, z: 0 }, []);
  assert.equal(c.hitFlashIntensity, 0);
});
