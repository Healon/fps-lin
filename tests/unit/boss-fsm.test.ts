// node:test 純邏輯單元測試：首領核心守護者 FSM（模式循環決定性、HP 門檻加壓、平台選點決定性、
// 彈幕扇形分布、震波 LOS 免傷規則、數值鎖定）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Boss,
  BOSS_MAX_HP,
  BOSS_HALF,
  BOSS_DEATH_SEQUENCE_DURATION,
  escalationTier,
  escalationParams,
  attackModeForCycle,
  pickNextPlatformIndex,
  fanDirections,
  BARRAGE_ROUND_COUNT_BASE,
  BARRAGE_ROUND_COUNT_TIER1,
  BARRAGE_ROUND_COUNT_TIER2,
  BARRAGE_ROUND_INTERVAL_BASE,
  BARRAGE_PROJECTILE_SPEED,
  BARRAGE_PROJECTILE_DAMAGE,
  SHOCKWAVE_TELEGRAPH_DURATION,
  SHOCKWAVE_DAMAGE,
  MAX_SUMMONED_ALIVE,
  HP_THRESHOLD_TIER1,
  HP_THRESHOLD_TIER2,
} from "../../src/game/boss.ts";
import { mulberry32 } from "../../src/rng/rng.ts";
import type { Aabb } from "../../src/procgen/level/level.ts";

const PLATFORMS = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 0, y: 0, z: 10 },
  { x: -10, y: 0, z: 0 },
  { x: 0, y: 0, z: -10 },
];

test("規格鎖定：核心守護者數值必須符合 PLAN §3.4 與本次派工規格", () => {
  assert.equal(BOSS_MAX_HP, 450, "PLAN §3.4：2026-08-05 由 900 砍半（Lin 實玩回饋）");
  assert.deepEqual(BOSS_HALF, { x: 1.3, y: 1.5, z: 1.2 });
  assert.equal(BARRAGE_ROUND_COUNT_BASE, 8);
  assert.equal(BARRAGE_ROUND_COUNT_TIER1, 10);
  assert.equal(BARRAGE_ROUND_COUNT_TIER2, 12);
  assert.equal(BARRAGE_PROJECTILE_SPEED, 10);
  assert.equal(BARRAGE_PROJECTILE_DAMAGE, 10);
  assert.equal(SHOCKWAVE_TELEGRAPH_DURATION, 1.2);
  assert.equal(SHOCKWAVE_DAMAGE, 30);
  assert.equal(MAX_SUMMONED_ALIVE, 4);
  assert.equal(HP_THRESHOLD_TIER1, 0.6);
  assert.equal(HP_THRESHOLD_TIER2, 0.3);
});

test("escalationTier：門檻邊界（60%／30%）", () => {
  assert.equal(escalationTier(1.0), 0);
  assert.equal(escalationTier(0.61), 0);
  assert.equal(escalationTier(0.6), 0, "恰好 60% 不算低於門檻");
  assert.equal(escalationTier(0.59), 1);
  assert.equal(escalationTier(0.31), 1);
  assert.equal(escalationTier(0.3), 1, "恰好 30% 不算低於門檻");
  assert.equal(escalationTier(0.29), 2);
  assert.equal(escalationTier(0), 2);
});

test("escalationParams：三級參數皆與規格相符，加壓時發數增加、間隔縮短、轉移時長縮短", () => {
  const t0 = escalationParams(0);
  const t1 = escalationParams(1);
  const t2 = escalationParams(2);
  assert.equal(t0.roundCount, 8);
  assert.equal(t1.roundCount, 10);
  assert.equal(t2.roundCount, 12);
  assert.ok(t1.roundInterval < t0.roundInterval);
  assert.ok(t2.roundInterval < t1.roundInterval);
  assert.ok(t1.repositionDuration < t0.repositionDuration);
  assert.ok(t2.repositionDuration < t1.repositionDuration);
});

test("attackModeForCycle：固定循環 barrage→summon→shockwave→barrage……", () => {
  assert.equal(attackModeForCycle(0), "barrage");
  assert.equal(attackModeForCycle(1), "summon");
  assert.equal(attackModeForCycle(2), "shockwave");
  assert.equal(attackModeForCycle(3), "barrage");
  assert.equal(attackModeForCycle(4), "summon");
  assert.equal(attackModeForCycle(5), "shockwave");
  assert.equal(attackModeForCycle(6), "barrage");
});

test("pickNextPlatformIndex：決定性（同 rng 序列同輸出）且絕不連續選中同一平台", () => {
  const rngA = mulberry32(12345);
  const rngB = mulberry32(12345);
  let current = 0;
  for (let i = 0; i < 50; i++) {
    const a = pickNextPlatformIndex(rngA, current, 5);
    const b = pickNextPlatformIndex(rngB, current, 5);
    assert.equal(a, b, `第 ${i} 次抽取應決定性相同`);
    assert.notEqual(a, current, `第 ${i} 次不應連續選中同一平台`);
    assert.ok(a >= 0 && a < 5);
    current = a;
  }
});

test("pickNextPlatformIndex：platformCount ≤ 1 恆回 0", () => {
  const rng = mulberry32(1);
  assert.equal(pickNextPlatformIndex(rng, 0, 1), 0);
  assert.equal(pickNextPlatformIndex(rng, 0, 0), 0);
});

test("fanDirections：count=1 回傳單一 baseDir 方向；count>1 對稱涵蓋指定弧度", () => {
  const base = { x: 0, z: -1 }; // 朝 -Z
  const single = fanDirections(base, 1, 50);
  assert.ok(Math.abs(single[0].x - 0) < 1e-9);
  assert.ok(Math.abs(single[0].z - -1) < 1e-9);

  const dirs = fanDirections(base, 5, 50);
  assert.equal(dirs.length, 5);
  // 首尾對稱：兩端 x 分量正負對稱（皆偏離中心 baseDir 相同角度）。
  assert.ok(Math.abs(dirs[0].x + dirs[4].x) < 1e-9, "首尾方向應對稱");
  // 中央（i=2）應等於 baseDir（奇數 count 時中點恰為中心角）。
  assert.ok(Math.abs(dirs[2].x - 0) < 1e-9);
  assert.ok(Math.abs(dirs[2].z - -1) < 1e-9);
  // 所有方向皆為單位向量（水平面）。
  for (const d of dirs) {
    const len = Math.hypot(d.x, d.z);
    assert.ok(Math.abs(len - 1) < 1e-9);
    assert.equal(d.y, 0);
  }
});

test("Boss.activate：從 inactive 立即進入 barrage（cycle 0）", () => {
  const boss = new Boss(PLATFORMS, "test.boss.activate");
  assert.equal(boss.state, "inactive");
  boss.activate({ x: 5, y: 0, z: 0 });
  assert.equal(boss.state, "barrage");
});

test("Boss：barrage 狀態應在時間推進中依序發出 roundCount 發（tier0＝8 發），發射方向皆單位向量", () => {
  const boss = new Boss(PLATFORMS, "test.boss.barrage");
  boss.activate({ x: 5, y: 0, z: 0 });
  let totalFired = 0;
  const seenDirs: { x: number; z: number }[] = [];
  for (let i = 0; i < 600 && boss.state === "barrage"; i++) {
    const result = boss.update(1 / 60, { x: 5, y: 0, z: 0 }, { x: 5, y: 1.7, z: 0 }, [], 0);
    for (const ev of result.barrageEvents) {
      totalFired++;
      seenDirs.push({ x: ev.dir.x, z: ev.dir.z });
      assert.equal(ev.speed, BARRAGE_PROJECTILE_SPEED);
      assert.equal(ev.damage, BARRAGE_PROJECTILE_DAMAGE);
      assert.ok(Math.abs(Math.hypot(ev.dir.x, ev.dir.z) - 1) < 1e-6);
    }
  }
  assert.equal(totalFired, 8, "tier0 應恰好發射 8 發");
  assert.equal(boss.state, "reposition", "彈幕發完應立即轉入平台轉移");
});

test("Boss：完整一輪循環 barrage→reposition→summon→reposition→shockwave-telegraph→reposition→barrage", () => {
  const boss = new Boss(PLATFORMS, "test.boss.cycle");
  boss.activate({ x: 5, y: 0, z: 0 });
  const seenStates: string[] = [boss.state];
  for (let i = 0; i < 100000 && seenStates.length < 400; i++) {
    boss.update(1 / 60, { x: 5, y: 0, z: 0 }, { x: 5, y: 1.7, z: 0 }, [], 0);
    if (boss.state !== seenStates[seenStates.length - 1]) seenStates.push(boss.state);
    if (seenStates.filter((s) => s === "barrage").length >= 2) break;
  }
  // 應依序看到完整一輪：barrage, reposition, summon, reposition, shockwave-telegraph, reposition, barrage(第二輪)
  const expected = ["barrage", "reposition", "summon", "reposition", "shockwave-telegraph", "reposition", "barrage"];
  assert.deepEqual(seenStates, expected);
});

test("Boss：召喚模式應回傳 2 或 3 之間的召喚請求，且受 MAX_SUMMONED_ALIVE 上限限制", () => {
  const boss = new Boss(PLATFORMS, "test.boss.summon");
  boss.activate({ x: 5, y: 0, z: 0 });
  // 快轉過 barrage → reposition，進入 summon。
  let summonRequest: { count: number } | null = null;
  for (let i = 0; i < 600 && summonRequest === null; i++) {
    const result = boss.update(1 / 60, { x: 5, y: 0, z: 0 }, { x: 5, y: 1.7, z: 0 }, [], 0);
    if (result.summonRequest) summonRequest = result.summonRequest;
  }
  assert.ok(summonRequest, "應觸發一次召喚請求");
  assert.ok(summonRequest!.count >= 2 && summonRequest!.count <= 3, `召喚數應為 2 或 3，實際 ${summonRequest!.count}`);
});

test("Boss：場上召喚物已達上限時，召喚請求 count 應為 0（不再召喚）", () => {
  const boss = new Boss(PLATFORMS, "test.boss.summon_cap");
  boss.activate({ x: 5, y: 0, z: 0 });
  let summonRequest: { count: number } | null = null;
  for (let i = 0; i < 600 && summonRequest === null; i++) {
    const result = boss.update(1 / 60, { x: 5, y: 0, z: 0 }, { x: 5, y: 1.7, z: 0 }, [], MAX_SUMMONED_ALIVE);
    if (result.summonRequest) summonRequest = result.summonRequest;
  }
  assert.ok(summonRequest);
  assert.equal(summonRequest!.count, 0);
});

test("Boss：震波引爆時無遮蔽（LOS 清楚）應造成傷害；有掩體遮蔽（無 LOS）應免傷（回傳 null）", () => {
  const bossClear = new Boss(PLATFORMS, "test.boss.shockwave.clear");
  bossClear.activate({ x: 5, y: 0, z: 0 });
  let shockwaveEvent: { damage: number } | null | undefined;
  for (let i = 0; i < 1200 && shockwaveEvent === undefined; i++) {
    const result = bossClear.update(1 / 60, { x: 5, y: 0, z: 0 }, { x: 5, y: 1.7, z: 0 }, [], 0);
    if (bossClear.state !== "shockwave-telegraph" && result.shockwaveEvent !== null) {
      // 只在剛離開 telegraph 狀態的那一幀才可能有非 null 事件（見下方判斷）。
    }
    if (result.shockwaveEvent) shockwaveEvent = result.shockwaveEvent;
  }
  assert.ok(shockwaveEvent, "無遮蔽時應造成傷害");
  assert.equal(shockwaveEvent!.damage, SHOCKWAVE_DAMAGE);

  // 有掩體：在首領與玩家之間放一道牆 AABB，貫穿整個模擬時間窗。
  const bossBlocked = new Boss(PLATFORMS, "test.boss.shockwave.blocked");
  bossBlocked.activate({ x: 5, y: 0, z: 0 });
  const wall: Aabb = { min: { x: 2, y: -1, z: -5 }, max: { x: 3, y: 5, z: 5 } };
  let sawTelegraph = false;
  let blockedDamaged = false;
  for (let i = 0; i < 1200; i++) {
    if (bossBlocked.state === "shockwave-telegraph") sawTelegraph = true;
    const result = bossBlocked.update(1 / 60, { x: 5, y: 0, z: 0 }, { x: 5, y: 1.7, z: 0 }, [wall], 0);
    if (result.shockwaveEvent) blockedDamaged = true;
    if (sawTelegraph && bossBlocked.state === "reposition") break;
  }
  assert.ok(sawTelegraph, "測試前提：應曾進入 shockwave-telegraph 狀態");
  assert.equal(blockedDamaged, false, "有掩體遮蔽時不應造成傷害");
});

test("Boss.applyDamage：全額傷害，無方向減傷；致命一擊轉 dead；已死亡不再受傷", () => {
  const boss = new Boss(PLATFORMS, "test.boss.damage");
  boss.activate({ x: 5, y: 0, z: 0 });
  const died1 = boss.applyDamage(100, { x: 1, y: 0, z: 0 });
  assert.equal(died1, false);
  assert.equal(boss.hp, BOSS_MAX_HP - 100, "應為全額傷害，不因方向而減半");
  const died2 = boss.applyDamage(999999);
  assert.equal(died2, true);
  assert.equal(boss.state, "dead");
  assert.equal(boss.hp, 0);
  const died3 = boss.applyDamage(10);
  assert.equal(died3, false, "已死亡不應再受傷害");
});

test("Boss.removable：死亡瞬間 false，BOSS_DEATH_SEQUENCE_DURATION 秒後 true", () => {
  const boss = new Boss(PLATFORMS, "test.boss.removable");
  boss.activate({ x: 5, y: 0, z: 0 });
  boss.applyDamage(999999);
  assert.equal(boss.removable, false);
  boss.update(BOSS_DEATH_SEQUENCE_DURATION + 0.1, { x: 5, y: 0, z: 0 }, { x: 5, y: 1.7, z: 0 }, [], 0);
  assert.equal(boss.removable, true);
});

test("Boss.setHpDebug：可直接壓 HP 觸發門檻加壓，hp≤0 直接轉 dead", () => {
  const boss = new Boss(PLATFORMS, "test.boss.debughp");
  boss.activate({ x: 5, y: 0, z: 0 });
  boss.setHpDebug(BOSS_MAX_HP * 0.5);
  assert.equal(escalationTier(boss.hp / BOSS_MAX_HP), 1);
  boss.setHpDebug(0);
  assert.equal(boss.state, "dead");
});

test("Boss FSM 與循環序列皆決定性：相同輸入序列兩次獨立模擬結果逐位元相同", () => {
  const runTrajectory = (): { x: number; z: number; state: string; hp: number }[] => {
    const boss = new Boss(PLATFORMS, "test.boss.trajectory");
    boss.activate({ x: 5, y: 0, z: 2 });
    const trail: { x: number; z: number; state: string; hp: number }[] = [];
    for (let i = 0; i < 500; i++) {
      boss.update(1 / 60, { x: 5, y: 0, z: 2 }, { x: 5, y: 1.7, z: 2 }, [], 0);
      trail.push({ x: boss.position.x, z: boss.position.z, state: boss.state, hp: boss.hp });
    }
    return trail;
  };
  const a = runTrajectory();
  const b = runTrajectory();
  assert.deepEqual(a, b);
});
