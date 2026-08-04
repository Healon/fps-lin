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
const VIGNETTE_INTENSITY = 0.35;

export class Hud {
  private readonly hpValueEl: HTMLDivElement;
  private readonly ammoValueEl: HTMLDivElement;
  private readonly hurtVignetteEl: HTMLDivElement;
  private readonly vignetteEl: HTMLDivElement;
  private readonly deathPanelEl: HTMLDivElement;
  private readonly deathMessageEl: HTMLDivElement;

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
    const ammoLabel = document.createElement("div");
    ammoLabel.textContent = "彈藥";
    Object.assign(ammoLabel.style, {
      fontSize: "11px",
      opacity: "0.7",
      letterSpacing: "0.08em",
      textAlign: "right",
    });
    this.ammoValueEl = document.createElement("div");
    Object.assign(this.ammoValueEl.style, {
      fontSize: "28px",
      fontWeight: "700",
      color: COLOR_AMMO,
      textAlign: "right",
    });
    ammoPanel.appendChild(ammoLabel);
    ammoPanel.appendChild(this.ammoValueEl);

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

    container.appendChild(hpPanel);
    container.appendChild(ammoPanel);
    container.appendChild(this.vignetteEl);
    container.appendChild(this.hurtVignetteEl);
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
    this.ammoValueEl.textContent = `${current} ／ ${max}`;
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
}
