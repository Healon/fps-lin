// 玩家生命值、受擊無敵、受傷紅暈與死亡重生的狀態機（純邏輯，不含 DOM；DOM 呈現交給 ui/hud.ts）。
// 數值取自 PLAN §3.2：HP 100、受擊無敵 0.15 秒、死亡重啟 3 秒。

export const PLAYER_MAX_HP = 100;
const INVULN_DURATION = 0.15; // 秒
const RESPAWN_DELAY = 3.0; // 秒
const HURT_FLASH_DURATION = 0.25; // 秒，螢幕紅暈衰減時間（純呈現用，與無敵時間各自獨立）

export class Combat {
  playerHp = PLAYER_MAX_HP;
  private invulnRemaining = 0;
  private hurtFlashRemaining = 0;
  private respawnRemaining = 0;
  private dead = false;

  get isDead(): boolean {
    return this.dead;
  }

  get respawnSecondsRemaining(): number {
    return Math.max(0, this.respawnRemaining);
  }

  /** 0（無）至 1（剛受傷）的紅暈強度，供 HUD 疊圖用。 */
  get hurtFlashIntensity(): number {
    return this.hurtFlashRemaining / HURT_FLASH_DURATION;
  }

  get isInvulnerable(): boolean {
    return this.invulnRemaining > 0;
  }

  /** 對玩家造成傷害。無敵中、已死亡或傷害量非正皆忽略，回傳 false 表示未生效。 */
  damagePlayer(amount: number): boolean {
    if (this.dead || this.invulnRemaining > 0 || amount <= 0) return false;

    this.playerHp = Math.max(0, this.playerHp - amount);
    this.invulnRemaining = INVULN_DURATION;
    this.hurtFlashRemaining = HURT_FLASH_DURATION;

    if (this.playerHp <= 0) {
      this.dead = true;
      this.respawnRemaining = RESPAWN_DELAY;
    }
    return true;
  }

  /**
   * 硬重置：不論目前是否死亡，一律回到滿血、無敵時間與紅暈歸零、死亡旗標清除。
   * 供「重新開始」（暫停選單，M2）使用，與 update() 內建的死亡自動重生路徑分開——
   * 那條路徑只在 playerHp 真的歸零時才觸發，本方法是任意時刻的手動硬重置。
   */
  reset(): void {
    this.playerHp = PLAYER_MAX_HP;
    this.invulnRemaining = 0;
    this.hurtFlashRemaining = 0;
    this.respawnRemaining = 0;
    this.dead = false;
  }

  /**
   * 治療：回復 amount 點生命值，上限 PLAYER_MAX_HP，回傳實際回復量（可能因封頂而小於 amount）。
   * 已死亡或 amount 非正時忽略並回傳 0（供 medkit 撿取使用，M2）。
   */
  heal(amount: number): number {
    if (this.dead || amount <= 0) return 0;
    const before = this.playerHp;
    this.playerHp = Math.min(PLAYER_MAX_HP, this.playerHp + amount);
    return this.playerHp - before;
  }

  /** 每幀呼叫。回傳 true 代表本幀觸發重生，呼叫端應重建玩家位置／敵人／彈藥狀態。 */
  update(dt: number): boolean {
    if (this.invulnRemaining > 0) this.invulnRemaining = Math.max(0, this.invulnRemaining - dt);
    if (this.hurtFlashRemaining > 0) this.hurtFlashRemaining = Math.max(0, this.hurtFlashRemaining - dt);

    if (this.dead) {
      this.respawnRemaining -= dt;
      if (this.respawnRemaining <= 0) {
        this.dead = false;
        this.playerHp = PLAYER_MAX_HP;
        this.invulnRemaining = 0;
        this.respawnRemaining = 0;
        return true;
      }
    }
    return false;
  }
}
