// HTML overlay：標題「PROJECT 96 [M0]」、「點擊進入」提示、簡易準星（CSS 十字）。
// 點擊後隱藏並要求 pointer lock；退出 lock（Esc）由呼叫端重新呼叫 show() 重現 overlay。
// 全部以行內樣式建立元素，不引入外部 CSS 檔，符合單檔輸出精神。
//
// 2026-08-04（M2）：主選單新增「設定」按鈕入口（onSettings()），並加入準星顯隱控制
// （showCrosshair／hideCrosshair）：非 playing 狀態（menu／paused／設定畫面）隱藏準星，
// 避免與選單文字重疊；由 main.ts 的 gameState 狀態機統一驅動（見 game/state.ts）。

const COLOR_BG = "#08090B";
const COLOR_PANEL = "#16191D";
const COLOR_TEXT = "#F2F2F2";
const COLOR_ACCENT = "#35E0FF";
const COLOR_ERROR = "#FF5A26";

export class Overlay {
  private readonly startPanel: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly errorPanel: HTMLDivElement;
  private readonly crosshairBars: HTMLDivElement[] = [];
  private onStartCallback: (() => void) | null = null;
  private onSettingsCallback: (() => void) | null = null;

  constructor(container: HTMLElement = document.body) {
    this.startPanel = this.buildStartPanel();
    this.crosshair = this.buildCrosshair();
    this.errorPanel = this.buildErrorPanel();

    container.appendChild(this.startPanel);
    container.appendChild(this.crosshair);
    container.appendChild(this.errorPanel);

    this.startPanel.addEventListener("click", () => {
      this.onStartCallback?.();
    });
  }

  private buildStartPanel(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "p96-start-overlay";
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "16px",
      background: `rgba(8, 9, 11, 0.72)`,
      color: COLOR_TEXT,
      cursor: "pointer",
      userSelect: "none",
      zIndex: "20",
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
    });

    const title = document.createElement("div");
    title.textContent = "PROJECT 96［M2］";
    Object.assign(title.style, {
      fontSize: "clamp(24px, 5vw, 48px)",
      fontWeight: "700",
      letterSpacing: "0.08em",
      color: COLOR_TEXT,
      textShadow: `0 0 24px ${COLOR_ACCENT}`,
    });

    const prompt = document.createElement("div");
    prompt.textContent = "點擊進入";
    Object.assign(prompt.style, {
      fontSize: "clamp(14px, 2vw, 18px)",
      color: COLOR_ACCENT,
      letterSpacing: "0.12em",
    });

    const controls = document.createElement("div");
    controls.innerHTML = [
      "W A S D：移動",
      "滑鼠 或 方向鍵：視角",
      "滑鼠左鍵 或 空白鍵：射擊",
      "1 2 3 4：切換武器",
      "E：互動",
      "Esc：暫停",
    ].join("<br>");
    Object.assign(controls.style, {
      fontSize: "clamp(12px, 1.6vw, 15px)",
      color: COLOR_TEXT,
      opacity: "0.72",
      letterSpacing: "0.08em",
      lineHeight: "2",
    });

    const settingsButton = document.createElement("button");
    settingsButton.textContent = "設定";
    settingsButton.dataset["role"] = "menu-settings-button";
    Object.assign(settingsButton.style, {
      marginTop: "8px",
      padding: "8px 24px",
      background: "transparent",
      border: `1px solid ${COLOR_ACCENT}`,
      borderRadius: "4px",
      color: COLOR_ACCENT,
      fontSize: "14px",
      letterSpacing: "0.1em",
      cursor: "pointer",
      fontFamily: "system-ui, -apple-system, sans-serif",
    });
    // stopPropagation：settingsButton 是 startPanel 的子元素，startPanel 本身也有點擊即開始的
    // 監聽器，不擋住冒泡的話點「設定」會同時觸發開始遊戲。
    settingsButton.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onSettingsCallback?.();
    });

    el.appendChild(title);
    el.appendChild(prompt);
    el.appendChild(controls);
    el.appendChild(settingsButton);
    return el;
  }

  private buildCrosshair(): HTMLDivElement {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      width: "16px",
      height: "16px",
      transform: "translate(-50%, -50%)",
      pointerEvents: "none",
      zIndex: "10",
    });

    const bar = (w: string, h: string): HTMLDivElement => {
      const b = document.createElement("div");
      Object.assign(b.style, {
        position: "absolute",
        top: "50%",
        left: "50%",
        width: w,
        height: h,
        transform: "translate(-50%, -50%)",
        background: COLOR_TEXT,
        opacity: "0.85",
      });
      return b;
    };

    const vertical = bar("2px", "16px");
    const horizontal = bar("16px", "2px");
    el.appendChild(vertical);
    el.appendChild(horizontal);
    this.crosshairBars.push(vertical, horizontal);
    return el;
  }

  /** M1 武器命中回饋：短暫將準星變色（警示橘），供 weapon.hitMarkerActive 驅動。 */
  setCrosshairHit(active: boolean): void {
    const color = active ? COLOR_ERROR : COLOR_TEXT;
    for (const bar of this.crosshairBars) bar.style.background = color;
  }

  private buildErrorPanel(): HTMLDivElement {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      background: COLOR_BG,
      color: COLOR_TEXT,
      zIndex: "30",
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
      padding: "24px",
    });

    const heading = document.createElement("div");
    heading.textContent = "發生錯誤";
    Object.assign(heading.style, {
      fontSize: "24px",
      fontWeight: "700",
      color: COLOR_ERROR,
    });

    const detail = document.createElement("div");
    detail.dataset["role"] = "detail";
    Object.assign(detail.style, {
      fontSize: "14px",
      color: COLOR_TEXT,
      maxWidth: "640px",
      whiteSpace: "pre-wrap",
      background: COLOR_PANEL,
      padding: "16px",
      borderRadius: "4px",
    });

    el.appendChild(heading);
    el.appendChild(detail);
    return el;
  }

  onStart(callback: () => void): void {
    this.onStartCallback = callback;
  }

  onSettings(callback: () => void): void {
    this.onSettingsCallback = callback;
  }

  show(): void {
    this.startPanel.style.display = "flex";
  }

  hide(): void {
    this.startPanel.style.display = "none";
  }

  showCrosshair(): void {
    this.crosshair.style.display = "block";
  }

  hideCrosshair(): void {
    this.crosshair.style.display = "none";
  }

  showError(message: string): void {
    this.startPanel.style.display = "none";
    this.errorPanel.style.display = "flex";
    const detail = this.errorPanel.querySelector<HTMLDivElement>('[data-role="detail"]');
    if (detail) detail.textContent = message;
  }
}
