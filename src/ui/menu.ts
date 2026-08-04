// 暫停選單與設定面板：HTML overlay，沿用 ui/overlay.ts 的視覺風格（system-ui、既有色票、
// 全形標點、行內樣式無外部 CSS 檔）。
//
// PauseMenu：playing → paused（Esc 或 pointer lock 退出）時顯示，提供「繼續／設定／重新開始」。
// SettingsPanel：主選單與暫停選單皆可進入（本次派工規格），三項設定各用加減按鈕（而非拖曳
// 滑桿）即時生效即時儲存——按鈕比滑桿更適合自動化測試（可精確重複點擊到目標值，不依賴
// range input 在無頭瀏覽器下的 fill() 行為）。z-index 高於暫停面板，兩者由 main.ts 依
// game/state.ts 的 GameStateMachine 統一驅動顯示邏輯。

import type { Settings, SettingsField } from "../core/settings.ts";
import { SENSITIVITY_MIN, SENSITIVITY_MAX, VOLUME_MIN, VOLUME_MAX, FOV_MIN, FOV_MAX } from "../core/settings.ts";

export type { SettingsField };

const COLOR_BG_OVERLAY = "rgba(8, 9, 11, 0.86)";
const COLOR_TEXT = "#F2F2F2";
const COLOR_ACCENT = "#35E0FF";

const FIELD_ORDER: readonly SettingsField[] = ["sensitivity", "volume", "fov"];
const FIELD_LABELS: Readonly<Record<SettingsField, string>> = {
  sensitivity: "滑鼠靈敏度",
  volume: "主音量",
  fov: "視野角 FOV",
};
const FIELD_STEPS: Readonly<Record<SettingsField, number>> = {
  sensitivity: 0.1,
  volume: 5,
  fov: 5,
};
const FIELD_RANGES: Readonly<Record<SettingsField, readonly [number, number]>> = {
  sensitivity: [SENSITIVITY_MIN, SENSITIVITY_MAX],
  volume: [VOLUME_MIN, VOLUME_MAX],
  fov: [FOV_MIN, FOV_MAX],
};
const FIELD_FORMAT: Readonly<Record<SettingsField, (v: number) => string>> = {
  sensitivity: (v) => `${v.toFixed(1)}x`,
  volume: (v) => `${Math.round(v)}`,
  fov: (v) => `${Math.round(v)}°`,
};

/** 依 step 取整，並清除浮點殘留誤差（如 1.0 + 0.1 三次的二進位表示誤差）。 */
function roundToStep(value: number, step: number): number {
  const stepped = Math.round(value / step) * step;
  return Math.round(stepped * 1000) / 1000;
}

function buildMenuButton(label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  Object.assign(btn.style, {
    padding: "10px 28px",
    background: "transparent",
    border: `1px solid ${COLOR_ACCENT}`,
    borderRadius: "4px",
    color: COLOR_TEXT,
    fontSize: "16px",
    letterSpacing: "0.08em",
    cursor: "pointer",
    fontFamily: "system-ui, -apple-system, sans-serif",
    minWidth: "200px",
  });
  return btn;
}

/** 暫停選單：playing → paused 時顯示（見 main.ts 的 gameState.onChange 驅動）。 */
export class PauseMenu {
  private readonly root: HTMLDivElement;
  private onResumeCb: (() => void) | null = null;
  private onSettingsCb: (() => void) | null = null;
  private onRestartCb: (() => void) | null = null;

  constructor(container: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.id = "p96-pause-overlay";
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "16px",
      background: COLOR_BG_OVERLAY,
      color: COLOR_TEXT,
      // 高於 hud.ts 的死亡畫面（25）：若玩家在死亡等待重生期間按 Esc 觸發暫停，
      // 暫停選單應蓋過死亡畫面（使用者明確操作的優先權高於自動顯示的畫面）。
      zIndex: "26",
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
    });

    const title = document.createElement("div");
    title.textContent = "已暫停";
    Object.assign(title.style, {
      fontSize: "clamp(22px, 4vw, 36px)",
      fontWeight: "700",
      marginBottom: "8px",
      color: COLOR_TEXT,
      textShadow: `0 0 24px ${COLOR_ACCENT}`,
    });

    const resumeBtn = buildMenuButton("繼續");
    resumeBtn.dataset["role"] = "pause-resume";
    resumeBtn.addEventListener("click", () => this.onResumeCb?.());

    const settingsBtn = buildMenuButton("設定");
    settingsBtn.dataset["role"] = "pause-settings";
    settingsBtn.addEventListener("click", () => this.onSettingsCb?.());

    const restartBtn = buildMenuButton("重新開始");
    restartBtn.dataset["role"] = "pause-restart";
    restartBtn.addEventListener("click", () => this.onRestartCb?.());

    this.root.appendChild(title);
    this.root.appendChild(resumeBtn);
    this.root.appendChild(settingsBtn);
    this.root.appendChild(restartBtn);
    container.appendChild(this.root);
  }

  onResume(cb: () => void): void {
    this.onResumeCb = cb;
  }

  onSettings(cb: () => void): void {
    this.onSettingsCb = cb;
  }

  onRestart(cb: () => void): void {
    this.onRestartCb = cb;
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}

/**
 * 設定面板：主選單與暫停選單皆可進入（呼叫端各自決定「返回」要回到哪一個，見 main.ts：
 * 一律以 syncUiForState(gameState.state) 依目前未變的狀態重新顯示正確的底層選單）。
 */
export class SettingsPanel {
  private readonly root: HTMLDivElement;
  private onBackCb: (() => void) | null = null;
  private onChangeCb: ((field: SettingsField, value: number) => void) | null = null;
  private readonly valueEls: Record<SettingsField, HTMLDivElement>;
  private readonly values: Record<SettingsField, number>;

  constructor(initial: Readonly<Settings>, container: HTMLElement = document.body) {
    this.values = { sensitivity: initial.sensitivity, volume: initial.volume, fov: initial.fov };

    this.root = document.createElement("div");
    this.root.id = "p96-settings-overlay";
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "22px",
      background: COLOR_BG_OVERLAY,
      color: COLOR_TEXT,
      zIndex: "27", // 高於 PauseMenu(26)：設定畫面可能疊在暫停選單之上開啟
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
    });

    const title = document.createElement("div");
    title.textContent = "設定";
    Object.assign(title.style, {
      fontSize: "clamp(22px, 4vw, 32px)",
      fontWeight: "700",
      color: COLOR_TEXT,
      textShadow: `0 0 24px ${COLOR_ACCENT}`,
    });
    this.root.appendChild(title);

    const valueEls = {} as Record<SettingsField, HTMLDivElement>;
    for (const field of FIELD_ORDER) {
      const { row, valueEl } = this.buildRow(field);
      valueEls[field] = valueEl;
      this.root.appendChild(row);
    }
    this.valueEls = valueEls;

    const backBtn = buildMenuButton("返回");
    backBtn.dataset["role"] = "settings-back";
    backBtn.addEventListener("click", () => this.onBackCb?.());
    this.root.appendChild(backBtn);

    container.appendChild(this.root);
  }

  private buildRow(field: SettingsField): { row: HTMLDivElement; valueEl: HTMLDivElement } {
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", alignItems: "center", gap: "12px" });

    const labelEl = document.createElement("div");
    labelEl.textContent = `${FIELD_LABELS[field]}：`;
    Object.assign(labelEl.style, {
      minWidth: "150px",
      textAlign: "right",
      fontSize: "14px",
      opacity: "0.85",
      letterSpacing: "0.04em",
    });

    const decBtn = document.createElement("button");
    decBtn.textContent = "－";
    decBtn.dataset["role"] = `${field}-dec`;
    this.styleStepButton(decBtn);

    const valueEl = document.createElement("div");
    valueEl.dataset["role"] = `${field}-value`;
    valueEl.textContent = FIELD_FORMAT[field](this.values[field]);
    Object.assign(valueEl.style, {
      minWidth: "68px",
      fontSize: "16px",
      fontWeight: "700",
      color: COLOR_ACCENT,
    });

    const incBtn = document.createElement("button");
    incBtn.textContent = "＋";
    incBtn.dataset["role"] = `${field}-inc`;
    this.styleStepButton(incBtn);

    const [lo, hi] = FIELD_RANGES[field];
    const step = FIELD_STEPS[field];
    const applyDelta = (sign: 1 | -1): void => {
      const next = Math.min(hi, Math.max(lo, roundToStep(this.values[field] + sign * step, step)));
      this.values[field] = next;
      valueEl.textContent = FIELD_FORMAT[field](next);
      this.onChangeCb?.(field, next);
    };
    decBtn.addEventListener("click", () => applyDelta(-1));
    incBtn.addEventListener("click", () => applyDelta(1));

    row.appendChild(labelEl);
    row.appendChild(decBtn);
    row.appendChild(valueEl);
    row.appendChild(incBtn);
    return { row, valueEl };
  }

  private styleStepButton(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      width: "32px",
      height: "32px",
      background: "transparent",
      border: `1px solid ${COLOR_ACCENT}`,
      borderRadius: "4px",
      color: COLOR_TEXT,
      fontSize: "16px",
      cursor: "pointer",
      fontFamily: "system-ui, -apple-system, sans-serif",
    });
  }

  onBack(cb: () => void): void {
    this.onBackCb = cb;
  }

  /** 使用者透過加減按鈕變更某項設定時觸發，呼叫端應轉交正式 API 並持久化（見 main.ts）。 */
  onChange(cb: (field: SettingsField, value: number) => void): void {
    this.onChangeCb = cb;
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
