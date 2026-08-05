// node:test 純邏輯單元測試：音樂系統排程器（lookahead scheduler 核心）與 explore／combat
// 滯後狀態機。兩者皆為純函式，無 AudioContext 依賴（見 src/audio/music.ts 檔頭註解）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scheduleWindow,
  stepDurationSeconds,
  stepHysteresis,
  INITIAL_HYSTERESIS_STATE,
  HYSTERESIS_SECONDS,
  EXPLORE_PING_TRACK,
  EXPLORE_RUMBLE_TRACK,
  COMBAT_BASS_TRACK,
  COMBAT_PERC_TRACK,
  type TrackPattern,
} from "../../src/audio/music.ts";

const BPM = 60;

test("stepDurationSeconds：60 BPM 的 16 分音符為 0.25 秒", () => {
  assert.equal(stepDurationSeconds(60), 0.25);
});

test("scheduleWindow：同輸入同輸出（決定性）", () => {
  const patterns: TrackPattern[] = [{ track: "a", steps: [true, false, true, false] }];
  const r1 = scheduleWindow(patterns, BPM, 0, 0, 1.0);
  const r2 = scheduleWindow(patterns, BPM, 0, 0, 1.0);
  assert.deepEqual(r1, r2);
});

test("scheduleWindow：只在 pattern 為 true 的步進產生事件，時間依 BPM 換算", () => {
  // pattern 為 [true,false,true,false]：true 落在 idx ≡ 0 或 2（mod 4），即秒數 0, 0.5, 1.0, 1.5...
  // horizon 取 1.6（略大於 idx=6 的 1.5 秒，小於 idx=8 的 2.0 秒），應恰得 idx 0,2,4,6 四筆。
  const patterns: TrackPattern[] = [{ track: "a", steps: [true, false, true, false] }];
  const { events } = scheduleWindow(patterns, BPM, 0, 0, 1.6);
  assert.deepEqual(
    events.map((e) => e.stepIndex),
    [0, 2, 4, 6],
  );
  for (const e of events) {
    assert.equal(e.time, e.stepIndex * 0.25);
    assert.equal(e.track, "a");
  }
});

test("scheduleWindow：連續分段呼叫（模擬每 25ms tick 排 120ms 窗）與一次涵蓋整段窗口結果完全相同（無重疊無遺漏）", () => {
  const patterns: TrackPattern[] = [
    { track: "a", steps: [true, false, true, false] },
    { track: "b", steps: [false, true, false, false, true] },
  ];

  const TICK = 0.12; // 呼應本次派工規格：約 25ms tick、預排 120ms
  const TICKS = 40;
  let idx = 0;
  let time = 0;
  let horizon = 0;
  const tiled: ReturnType<typeof scheduleWindow>["events"] = [];
  for (let i = 0; i < TICKS; i++) {
    horizon += TICK;
    const r = scheduleWindow(patterns, BPM, idx, time, horizon);
    tiled.push(...r.events);
    idx = r.nextStepIndex;
    time = r.nextStepTime;
  }

  // 用「同一個」累加後的 horizon 值一次涵蓋整段窗口（避免浮點數獨立累加造成邊界誤差）。
  const combined = scheduleWindow(patterns, BPM, 0, 0, horizon);

  assert.deepEqual(tiled, combined.events);
  assert.ok(tiled.length > 0, "應排出至少一筆事件，否則測試沒有驗證到任何東西");

  // 事件時間單調不減（排程器輸出必為時間序）。
  for (let i = 1; i < tiled.length; i++) {
    assert.ok(tiled[i].time >= tiled[i - 1].time, `事件應依時間排序：index ${i}`);
  }
});

test("scheduleWindow：空窗口（horizon 未超過 nextStepTime）不產生任何事件", () => {
  const patterns: TrackPattern[] = [{ track: "a", steps: [true] }];
  const { events, nextStepIndex, nextStepTime } = scheduleWindow(patterns, BPM, 5, 10.0, 10.0);
  assert.deepEqual(events, []);
  assert.equal(nextStepIndex, 5);
  assert.equal(nextStepTime, 10.0);
});

test("Pattern 資料表：探索態稀疏（數小節一次），戰鬥態密集（PLAN §6.5 決定性資料）", () => {
  assert.equal(EXPLORE_PING_TRACK.steps.length, 64);
  assert.equal(EXPLORE_PING_TRACK.steps.filter(Boolean).length, 1, "explore-ping 應數十步才響一次");

  assert.equal(EXPLORE_RUMBLE_TRACK.steps.length, 96);
  assert.equal(EXPLORE_RUMBLE_TRACK.steps.filter(Boolean).length, 1, "explore-rumble 應偶發，數小節一次");

  assert.equal(COMBAT_BASS_TRACK.steps.length, 16);
  assert.ok(COMBAT_BASS_TRACK.steps.filter(Boolean).length >= 4, "combat-bass 應為 16 分音符脈衝，密度明顯高於 explore");

  assert.equal(COMBAT_PERC_TRACK.steps.length, 16);
  const percHits = COMBAT_PERC_TRACK.steps.filter(Boolean).length;
  const pingRate = EXPLORE_PING_TRACK.steps.filter(Boolean).length / EXPLORE_PING_TRACK.steps.length;
  const percRate = percHits / COMBAT_PERC_TRACK.steps.length;
  assert.ok(percRate > pingRate, "戰鬥態打擊層密度應明顯高於探索態稀疏敲擊（本次派工規格）");
});

test("stepHysteresis：初始 explore，無 aggro 時維持 explore", () => {
  const s = stepHysteresis(INITIAL_HYSTERESIS_STATE, false, 1);
  assert.deepEqual(s, INITIAL_HYSTERESIS_STATE);
});

test("stepHysteresis：aggro 立即轉 combat 並把滯後計時設回 HYSTERESIS_SECONDS", () => {
  const s = stepHysteresis(INITIAL_HYSTERESIS_STATE, true, 0.016);
  assert.equal(s.layer, "combat");
  assert.equal(s.hysteresisRemaining, HYSTERESIS_SECONDS);
});

test("stepHysteresis：脫離 aggro 後在 HYSTERESIS_SECONDS 秒內持續維持 combat（未過滯後不提前切回）", () => {
  let s = stepHysteresis(INITIAL_HYSTERESIS_STATE, true, 0);
  // 累計流逝時間略小於滯後秒數（3 秒），應仍是 combat。
  const dt = 0.5;
  const steps = Math.floor((HYSTERESIS_SECONDS - 0.1) / dt);
  for (let i = 0; i < steps; i++) {
    s = stepHysteresis(s, false, dt);
    assert.equal(s.layer, "combat", `第 ${i} 步不應提前切回 explore`);
  }
});

test("stepHysteresis：滯後秒數用盡後準確轉回 explore", () => {
  let s = stepHysteresis(INITIAL_HYSTERESIS_STATE, true, 0);
  s = stepHysteresis(s, false, HYSTERESIS_SECONDS + 0.001);
  assert.equal(s.layer, "explore");
  assert.equal(s.hysteresisRemaining, 0);
});

test("stepHysteresis：滯後倒數期間再次 aggro 會重置計時（不會提前切回）", () => {
  let s = stepHysteresis(INITIAL_HYSTERESIS_STATE, true, 0);
  s = stepHysteresis(s, false, HYSTERESIS_SECONDS - 0.5); // 還剩 0.5 秒就要切回
  assert.equal(s.layer, "combat");
  s = stepHysteresis(s, true, 0); // 重新 aggro：計時應重置回滿額
  assert.equal(s.hysteresisRemaining, HYSTERESIS_SECONDS);
  // 若計時真的重置，再流逝略少於 3 秒仍應維持 combat（若沒重置，這裡會提前變 explore）。
  s = stepHysteresis(s, false, HYSTERESIS_SECONDS - 0.1);
  assert.equal(s.layer, "combat");
});
