// 最小 HUD：左下生命值、右下彈藥、受傷紅暈、死亡畫面、常駐環境暗角。純 DOM overlay，
// 行內樣式，不引入外部 CSS 檔（符合單檔輸出精神）。中央準星沿用 ui/overlay.ts（M0）既有元素，
// 本模組不重建準星，僅由呼叫端（main.ts）透過 Overlay 的方法驅動其命中回饋閃爍。
//
// 2026-08-04：移除原本開火時的螢幕青色閃光（setMuzzleFlash）——已由第一人稱 viewmodel 的
// 實體槍口閃光 quad 取代（見 gfx/renderer.ts renderFx／main.ts），避免兩種閃光重複顯得雜亂。
// 另加常駐暗角疊圖（PLAN §5.1 v3「恐懼而非溫馨」美術方向）。

const COLOR_TEXT = "#F2F2F2"; // 互動白
const COLOR_PANEL = "rgba(22, 25, 29, 0.72)"; // 金屬深灰半透明
const COLOR_HP = "#3DFF8E"; // 治療綠
const COLOR_HP_LOW = "#FF5A26"; // 警示橘（低血量警示）
const COLOR_AMMO = "#35E0FF"; // 能源青
const COLOR_ERROR = "#FF5A26";
const HP_LOW_THRESHOLD = 0.3;
const VIGNETTE_INTENSITY = 0.28; // 2026-08-05 由 0.35 放鬆（配合整體亮度上調，Lin 實玩回饋）

const WEAPON_LABEL: Readonly<Record<string, string>> = {
  pistol: "脈衝手槍",
  shotgun: "散射槍",
  plasma: "電漿步槍",
  cannon: "能量砲",
};

/** M3 第三階段新增：警示橘（PLAN §5.1 #FF5A26），首領血量條前景色。 */
const COLOR_BOSS_HP = "#FF5A26";

export class Hud {
  private readonly hpValueEl: HTMLDivElement;
  private readonly ammoValueEl: HTMLDivElement;
  private readonly weaponNameEl: HTMLDivElement;
  private readonly hurtVignetteEl: HTMLDivElement;
  private readonly vignetteEl: HTMLDivElement;
  private readonly deathPanelEl: HTMLDivElement;
  private readonly deathMessageEl: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private toastRemaining = 0;
  // M3 第三階段新增：首領血量條（頂部）、能量砲充能條、全場脈衝震波 telegraph 紅光疊圖。
  private readonly bossPanelEl: HTMLDivElement;
  private readonly bossNameEl: HTMLDivElement;
  private readonly bossHpFillEl: HTMLDivElement;
  private readonly cannonChargeEl: HTMLDivElement;
  private readonly cannonChargeFillEl: HTMLDivElement;
  private readonly shockwaveTelegraphEl: HTMLDivElement;
  private readonly coreOverloadEl: HTMLDivElement;

  constructor(container: HTMLElement = document.body) {
    const hpPanel = this.buildCornerPanel("left");
    const hpLabel = document.createElement("div");
    hpLabel.textContent = "生命值";
    Object.assign(hpLabel.style, { fontSize: "11px", opacity: "0.7", letterSpacing: "0.08em" });
    this.hpValueEl = document.createElement("div");
    Object.assign(this.hpValueEl.style, { fontSize: "28px", fontWeight: "700", color: COLOR_HP });
    hpPanel.appendChild(hpLabel);
    hpPanel.appendChild(this.hpValueEl);

    const ammoPanel = this.buildCornerPanel("right");
    this.weaponNameEl = document.createElement("div");
    this.weaponNameEl.dataset["role"] = "weapon-name";
    Object.assign(this.weaponNameEl.style, {
      fontSize: "11px",
      opacity: "0.7",
      letterSpacing: "0.08em",
      textAlign: "right",
    });
    this.weaponNameEl.textContent = "赤手空拳";
    this.ammoValueEl = document.createElement("div");
    this.ammoValueEl.dataset["role"] = "ammo-value";
    Object.assign(this.ammoValueEl.style, {
      fontSize: "28px",
      fontWeight: "700",
      color: COLOR_AMMO,
      textAlign: "right",
    });
    ammoPanel.appendChild(this.weaponNameEl);
    ammoPanel.appendChild(this.ammoValueEl);

    this.hintEl = document.createElement("div");
    this.hintEl.dataset["role"] = "objective-hint";
    Object.assign(this.hintEl.style, {
      position: "fixed",
      top: "18%",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "6px 18px",
      background: COLOR_PANEL,
      borderRadius: "4px",
      color: COLOR_TEXT,
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "14px",
      letterSpacing: "0.06em",
      zIndex: "14",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 150ms ease-out",
      textAlign: "center",
    });

    this.toastEl = document.createElement("div");
    this.toastEl.dataset["role"] = "pickup-toast";
    Object.assign(this.toastEl.style, {
      position: "fixed",
      bottom: "26%",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 22px",
      background: COLOR_PANEL,
      borderRadius: "4px",
      color: COLOR_AMMO,
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "16px",
      fontWeight: "700",
      letterSpacing: "0.06em",
      zIndex: "14",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 200ms ease-out",
      textAlign: "center",
    });

    this.hurtVignetteEl = document.createElement("div");
    this.hurtVignetteEl.id = "p96-hurt-vignette";
    Object.assign(this.hurtVignetteEl.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "15",
      background:
        "radial-gradient(ellipse at center, rgba(255,90,38,0) 55%, rgba(255,90,38,0.55) 100%)",
      opacity: "0",
      transition: "opacity 80ms ease-out",
    });

    this.vignetteEl = document.createElement("div");
    this.vignetteEl.id = "p96-vignette";
    Object.assign(this.vignetteEl.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "13", // 低於 hurtVignette(15)，常駐環境暗角
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${VIGNETTE_INTENSITY}) 100%)`,
    });

    this.deathPanelEl = document.createElement("div");
    this.deathPanelEl.id = "p96-death-panel";
    Object.assign(this.deathPanelEl.style, {
      position: "fixed",
      inset: "0",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      background: "rgba(8, 9, 11, 0.86)",
      color: COLOR_TEXT,
      zIndex: "25",
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
    });
    const deathTitle = document.createElement("div");
    deathTitle.textContent = "你已陣亡";
    Object.assign(deathTitle.style, {
      fontSize: "clamp(24px, 5vw, 40px)",
      fontWeight: "700",
      color: COLOR_ERROR,
    });
    this.deathMessageEl = document.createElement("div");
    this.deathMessageEl.dataset["role"] = "death-message";
    Object.assign(this.deathMessageEl.style, { fontSize: "16px", color: COLOR_TEXT, opacity: "0.85" });
    this.deathPanelEl.appendChild(deathTitle);
    this.deathPanelEl.appendChild(this.deathMessageEl);

    // 首領血量條（頂部，M3 第三階段新增）：進入區域 F 首領戰時顯示（見 showBossHealth）。
    this.bossPanelEl = document.createElement("div");
    this.bossPanelEl.dataset["role"] = "boss-health-panel";
    Object.assign(this.bossPanelEl.style, {
      position: "fixed",
      top: "18px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(560px, 70vw)",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
      zIndex: "12",
      fontFamily: "system-ui, -apple-system, sans-serif",
    });
    this.bossNameEl = document.createElement("div");
    this.bossNameEl.dataset["role"] = "boss-name";
    Object.assign(this.bossNameEl.style, {
      fontSize: "13px",
      letterSpacing: "0.16em",
      color: COLOR_BOSS_HP,
      textShadow: `0 0 12px ${COLOR_BOSS_HP}`,
    });
    const bossHpTrack = document.createElement("div");
    Object.assign(bossHpTrack.style, {
      width: "100%",
      height: "10px",
      background: COLOR_PANEL,
      border: `1px solid ${COLOR_BOSS_HP}`,
      borderRadius: "3px",
      overflow: "hidden",
    });
    this.bossHpFillEl = document.createElement("div");
    this.bossHpFillEl.dataset["role"] = "boss-hp-fill";
    Object.assign(this.bossHpFillEl.style, {
      width: "100%",
      height: "100%",
      background: COLOR_BOSS_HP,
      transition: "width 120ms ease-out",
    });
    bossHpTrack.appendChild(this.bossHpFillEl);
    this.bossPanelEl.appendChild(this.bossNameEl);
    this.bossPanelEl.appendChild(bossHpTrack);

    // 能量砲充能條（M3 第三階段新增）：充能中顯示於準星下方（見 updateCannonCharge）。
    this.cannonChargeEl = document.createElement("div");
    this.cannonChargeEl.dataset["role"] = "cannon-charge-panel";
    Object.assign(this.cannonChargeEl.style, {
      position: "fixed",
      top: "58%",
      left: "50%",
      transform: "translateX(-50%)",
      width: "160px",
      height: "8px",
      display: "none",
      background: COLOR_PANEL,
      border: `1px solid ${COLOR_AMMO}`,
      borderRadius: "3px",
      overflow: "hidden",
      zIndex: "12",
    });
    this.cannonChargeFillEl = document.createElement("div");
    this.cannonChargeFillEl.dataset["role"] = "cannon-charge-fill";
    Object.assign(this.cannonChargeFillEl.style, {
      width: "0%",
      height: "100%",
      background: COLOR_AMMO,
    });
    this.cannonChargeEl.appendChild(this.cannonChargeFillEl);

    // 全場脈衝震波 telegraph 紅光疊圖（M3 第三階段新增，同 hurtVignetteEl 慣例但獨立元素，
    // 避免與受傷紅暈的計時邏輯互相覆蓋）。
    this.shockwaveTelegraphEl = document.createElement("div");
    this.shockwaveTelegraphEl.dataset["role"] = "boss-shockwave-telegraph";
    Object.assign(this.shockwaveTelegraphEl.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "16",
      background: "radial-gradient(ellipse at center, rgba(255,90,38,0) 40%, rgba(255,90,38,0.6) 100%)",
      opacity: "0",
    });

    // 核心過載閃白（M3 第三階段新增，PLAN §4.4：「首領溶解加全場閃白漸強約 2 秒」）：
    // 獨立於受傷紅暈與震波紅光，白色徑向疊圖，main.ts 於首領死亡後的結尾序列期間驅動。
    this.coreOverloadEl = document.createElement("div");
    this.coreOverloadEl.dataset["role"] = "core-overload-flash";
    Object.assign(this.coreOverloadEl.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "17",
      background: "radial-gradient(ellipse at center, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 100%)",
      opacity: "0",
    });

    container.appendChild(hpPanel);
    container.appendChild(ammoPanel);
    container.appendChild(this.vignetteEl);
    container.appendChild(this.hurtVignetteEl);
    container.appendChild(this.shockwaveTelegraphEl);
    container.appendChild(this.coreOverloadEl);
    container.appendChild(this.hintEl);
    container.appendChild(this.toastEl);
    container.appendChild(this.bossPanelEl);
    container.appendChild(this.cannonChargeEl);
    container.appendChild(this.deathPanelEl);
  }

  private buildCornerPanel(side: "left" | "right"): HTMLDivElement {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed",
      bottom: "20px",
      [side]: "24px",
      padding: "8px 14px",
      background: COLOR_PANEL,
      borderRadius: "4px",
      fontFamily: "system-ui, -apple-system, sans-serif",
      color: COLOR_TEXT,
      zIndex: "12",
      minWidth: "84px",
    });
    return el;
  }

  updateHp(hp: number, maxHp: number): void {
    this.hpValueEl.textContent = `${Math.max(0, Math.round(hp))}`;
    this.hpValueEl.style.color = hp / maxHp <= HP_LOW_THRESHOLD ? COLOR_HP_LOW : COLOR_HP;
  }

  updateAmmo(current: number, max: number): void {
    this.ammoValueEl.textContent = max > 0 ? `${current} ／ ${max}` : "－";
  }

  /** weaponId 為 null 表示尚未裝備任何武器（區域 A 出生時赤手空拳，撿取前不可開火）。 */
  updateWeaponName(weaponId: "pistol" | "shotgun" | "plasma" | "cannon" | null): void {
    this.weaponNameEl.textContent = weaponId ? WEAPON_LABEL[weaponId] : "赤手空拳";
  }

  /** intensity 為 0（無）至 1（剛受傷）的紅暈強度。 */
  setHurtFlash(intensity: number): void {
    const clamped = Math.max(0, Math.min(1, intensity));
    this.hurtVignetteEl.style.opacity = `${clamped}`;
  }

  showDeathScreen(respawnSecondsRemaining: number): void {
    this.deathPanelEl.style.display = "flex";
    this.deathMessageEl.textContent = `將於 ${Math.max(0, respawnSecondsRemaining).toFixed(1)} 秒後於起點重生`;
  }

  hideDeathScreen(): void {
    this.deathPanelEl.style.display = "none";
  }

  /** 持續顯示的引導／鎖定提示（門鎖定原因、尚未持有武器引導）。text 為 null 時隱藏。 */
  setHint(text: string | null): void {
    if (text) {
      this.hintEl.textContent = text;
      this.hintEl.style.opacity = "1";
    } else {
      this.hintEl.style.opacity = "0";
    }
  }

  /** 短暫 toast（拾取回饋），duration 秒後自動淡出；呼叫端每幀呼叫 updateToast(dt) 驅動衰減。 */
  showToast(text: string, duration = 1.6): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = "1";
    this.toastRemaining = duration;
  }

  /** 每幀呼叫（simDt，暫停時應傳 0 或不呼叫，讓 toast 隨模擬暫停）：遞減 toast 剩餘時間。 */
  updateToast(dt: number): void {
    if (this.toastRemaining <= 0) return;
    this.toastRemaining = Math.max(0, this.toastRemaining - dt);
    if (this.toastRemaining === 0) this.toastEl.style.opacity = "0";
  }

  // ---- M3 第三階段新增：首領血量條、能量砲充能條、震波 telegraph 紅光 ----

  /** 顯示首領血量條並設定名稱（PLAN §3.4：進入區域 F 首領戰出現，名稱「核心守護者」）。 */
  showBossHealth(name: string): void {
    this.bossNameEl.textContent = name;
    this.bossPanelEl.style.display = "flex";
  }

  hideBossHealth(): void {
    this.bossPanelEl.style.display = "none";
  }

  updateBossHealth(hp: number, maxHp: number): void {
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    this.bossHpFillEl.style.width = `${(ratio * 100).toFixed(2)}%`;
  }

  /** 能量砲充能條：active=false 時隱藏（未充能或非能量砲），progress 為 0 至 1。 */
  updateCannonCharge(progress: number, active: boolean): void {
    this.cannonChargeEl.style.display = active ? "block" : "none";
    this.cannonChargeFillEl.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }

  /** 全場脈衝震波 telegraph 紅光強度，0（無）至 1（即將引爆）；main.ts 由
   *  Boss.telegraphIntensity 驅動（見 game/boss.ts）。 */
  setBossShockwaveTelegraph(intensity: number): void {
    this.shockwaveTelegraphEl.style.opacity = `${Math.max(0, Math.min(1, intensity))}`;
  }

  /** 核心過載閃白強度，0（無）至 1（全白）；main.ts 於首領死亡後的真結局序列期間驅動
   *  （PLAN §4.4：約 2 秒漸強）。 */
  setCoreOverloadFlash(intensity: number): void {
    this.coreOverloadEl.style.opacity = `${Math.max(0, Math.min(1, intensity))}`;
  }
}
