// node:test 純邏輯單元測試：玩家生命值、受擊無敵、死亡與重生計時器。
import { test } from "node:test";
import assert from "node:assert/strict";
import { Combat, PLAYER_MAX_HP } from "../../src/game/combat.ts";

test("初始 HP 為 100（PLAN §3.2）", () => {
  const combat = new Combat();
  assert.equal(combat.playerHp, PLAYER_MAX_HP);
  assert.equal(combat.isDead, false);
});

test("damagePlayer 扣血並回傳 true；無敵時間內再次受傷無效", () => {
  const combat = new Combat();
  assert.equal(combat.damagePlayer(30), true);
  assert.equal(combat.playerHp, 70);
  assert.equal(combat.damagePlayer(30), false, "受擊無敵 0.15 秒內應忽略");
  assert.equal(combat.playerHp, 70);
});

test("無敵時間過後可再次受傷", () => {
  const combat = new Combat();
  combat.damagePlayer(10);
  combat.update(0.2); // 超過 0.15 秒無敵時間
  assert.equal(combat.damagePlayer(10), true);
  assert.equal(combat.playerHp, 80);
});

test("HP 歸零觸發死亡，3 秒後 update 回傳 true 並重置 HP", () => {
  const combat = new Combat();
  combat.damagePlayer(1000);
  assert.equal(combat.playerHp, 0);
  assert.equal(combat.isDead, true);

  let respawned = false;
  for (let i = 0; i < 300; i++) {
    respawned = combat.update(1 / 60) || respawned;
  }
  assert.equal(respawned, true, "5 秒內應已觸發重生（延遲 3 秒）");
  assert.equal(combat.isDead, false);
  assert.equal(combat.playerHp, PLAYER_MAX_HP);
});

test("死亡前 update 不觸發重生（respawnSecondsRemaining 遞減但未歸零）", () => {
  const combat = new Combat();
  combat.damagePlayer(1000);
  const before = combat.respawnSecondsRemaining;
  const triggered = combat.update(0.5);
  assert.equal(triggered, false);
  assert.ok(combat.respawnSecondsRemaining < before);
});

test("hurtFlashIntensity 受傷後為正值，隨時間衰減至 0", () => {
  const combat = new Combat();
  combat.damagePlayer(10);
  assert.ok(combat.hurtFlashIntensity > 0);
  combat.update(1);
  assert.equal(combat.hurtFlashIntensity, 0);
});
