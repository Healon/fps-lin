// 暫停選單與設定面板：HTML overlay，沿用 ui/overlay.ts 的視覺風格（system-ui、既有色票、
// 全形標點、行內樣式無外部 CSS 檔）。
//
// PauseMenu：playing → paused（Esc 或 pointer lock 退出）時顯示，提供「繼續／設定／重新開始」。
// SettingsPanel：主選單與暫停選單皆可進入（本次派工規格），三項數值設定各用加減按鈕（而非拖曳
// 滑桿）即時生效即時儲存——按鈕比滑桿更適合自動化測試（可精確重複點擊到目標值，不依賴
// range input 在無頭瀏覽器下的 fill() 行為）。z-index 高於暫停面板，兩者由 main.ts 依
// game/state.ts 的 GameStateMachine 統一驅動顯示邏輯。
//
// M3 第四階段新增「按鍵設定」區：前進／後退／左移／右移／射擊／互動六個動作可重設，方向鍵
// 視角、數字鍵武器切換、Esc 暫停固定不可重設（面板內明示）。點「重新綁定」進入擷取態，下一次
// 按鍵即為新綁定（Esc 取消，不變更）；若該鍵已被其他動作使用則兩者互換，並提示互換結果。

import type { Settings, SettingsField, KeyBindings, KeyBindableAction } from "../core/settings.ts";
import {
  SENSITIVITY_MIN,
  SENSITIVITY_MAX,
  VOLUME_MIN,
  VOLUME_MAX,
  FOV_MIN,
  FOV_MAX,
  KEY_BINDABLE_ACTIONS,
} from "../core/settings.ts";
import { keyCodeDisplayName } from "./key-display.ts";

export type { SettingsField };

const KEY_ACTION_LABELS: Readonly<Record<KeyBindableAction, string>> = {
  forward: "前進",
  back: "後退",
  left: "左移",
  right: "右移",
  fire: "射擊",
  interact: "互動",
};

const CAPTURE_PROMPT_TEXT = "請按下新按鍵…（Esc 取消）";

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

/** 開場文字（PLAN §4.4：三至五行，繁體全形標點，極簡）。M3 第三階段新增。 */
const INTRO_LINES: readonly string[] = [
  "你在失控的地下能源設施甦醒。",
  "機械系統正在吞噬、融合殘存的生物組織。",
  "警報聲迴盪在鏽蝕的走廊深處。",
  "唯一的出路，是摧毀設施核心。",
];
const INTRO_DISPLAY_MS = 4000; // 本次派工規格：約 4 秒
const INTRO_FADE_MS = 500;

/**
 * 開場文字畫面（M3 第三階段新增）：從主選單點擊進入後、控制權交給玩家前顯示，黑底漸入漸出，
 * 約 4 秒後自動完成，可按任意鍵跳過。main.ts 只在「新局開始」（含首次進入與暫停選單「重新
 * 開始」，兩者皆會先完整重建關卡狀態）呼叫 show()，死亡自動重生路徑不呼叫（本次派工規格：
 * 「重生不重播；重新開始重播」）。show() 呼叫期間 game/state.ts 的狀態仍維持在呼叫前的狀態
 * （menu 或 paused），直到 onComplete 回呼才由呼叫端轉入 playing，確保「控制權交給玩家前」
 * 玩家無法移動或開火（沿用主迴圈既有的 `gameState.state === "playing"` 狀態閘）。
 */
export class IntroScreen {
  private readonly root: HTMLDivElement;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private fadeOutHandle: ReturnType<typeof setTimeout> | null = null;
  private keyHandler: (() => void) | null = null;
  private onCompleteCb: (() => void) | null = null;

  constructor(container: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.id = "p96-intro-overlay";
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: "#08090B",
      color: COLOR_TEXT,
      zIndex: "22", // 低於 PauseMenu(26)／SettingsPanel(27)／WinScreen(28)，高於一般 HUD
      opacity: "0",
      transition: `opacity ${INTRO_FADE_MS}ms ease`,
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
      cursor: "pointer",
      userSelect: "none",
    });

    const textEl = document.createElement("div");
    textEl.dataset["role"] = "intro-text";
    textEl.textContent = INTRO_LINES.join("\n");
    Object.assign(textEl.style, {
      fontSize: "clamp(16px, 2.4vw, 22px)",
      lineHeight: "2.2",
      letterSpacing: "0.06em",
      color: COLOR_TEXT,
      opacity: "0.92",
      maxWidth: "780px",
      padding: "0 24px",
      whiteSpace: "pre-line",
    });
    this.root.appendChild(textEl);
    container.appendChild(this.root);

    this.root.addEventListener("click", () => this.finish());
  }

  /** 顯示開場文字並於完成（時間到或使用者跳過）後呼叫 onComplete 一次。 */
  show(onComplete: () => void): void {
    this.onCompleteCb = onComplete;
    this.root.style.display = "flex";
    // 強制 reflow 後再設 opacity，確保 CSS transition 生效（標準 fade-in 寫法）。
    void this.root.offsetWidth;
    this.root.style.opacity = "1";

    this.keyHandler = () => this.finish();
    window.addEventListener("keydown", this.keyHandler, { once: true });
    this.timeoutHandle = setTimeout(() => this.finish(), INTRO_DISPLAY_MS);
  }

  private finish(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    if (this.onCompleteCb === null) return; // 已完成過（例如先跳過又剛好逾時），避免重複觸發。
    this.root.style.opacity = "0";
    const cb = this.onCompleteCb;
    this.onCompleteCb = null;
    this.fadeOutHandle = setTimeout(() => {
      this.root.style.display = "none";
      this.fadeOutHandle = null;
      cb();
    }, INTRO_FADE_MS);
  }
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
  private onKeyRebindCb: ((action: KeyBindableAction, code: string) => void) | null = null;
  private onKeyResetCb: (() => void) | null = null;
  private readonly valueEls: Record<SettingsField, HTMLDivElement>;
  private readonly values: Record<SettingsField, number>;
  private readonly keyValueEls: Record<KeyBindableAction, HTMLDivElement>;
  private keyBindings: KeyBindings;
  /** 目前正在擷取新按鍵的動作（null＝未在擷取），同一時間至多一項擷取中，避免重疊監聽器。 */
  private capturingAction: KeyBindableAction | null = null;

  constructor(initial: Readonly<Settings>, initialKeyBindings: Readonly<KeyBindings>, container: HTMLElement = document.body) {
    this.values = { sensitivity: initial.sensitivity, volume: initial.volume, fov: initial.fov };
    this.keyBindings = { ...initialKeyBindings };

    this.root = document.createElement("div");
    this.root.id = "p96-settings-overlay";
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
      zIndex: "27", // 高於 PauseMenu(26)：設定畫面可能疊在暫停選單之上開啟
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
      // 按鍵設定區使六項內容變多，面板可能高於視窗（尤其小螢幕）：允許垂直捲動並保留上下邊距，
      // 避免內容被裁切而點不到「返回」按鈕。
      maxHeight: "92vh",
      overflowY: "auto",
      padding: "16px 0",
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

    const keySectionTitle = document.createElement("div");
    keySectionTitle.textContent = "按鍵設定";
    Object.assign(keySectionTitle.style, {
      fontSize: "16px",
      fontWeight: "700",
      color: COLOR_TEXT,
      marginTop: "6px",
    });
    this.root.appendChild(keySectionTitle);

    const keySectionNote = document.createElement("div");
    keySectionNote.textContent = "方向鍵視角、數字鍵 1234 切換武器、Esc 暫停為固定按鍵，不可重設。";
    Object.assign(keySectionNote.style, {
      fontSize: "12px",
      color: COLOR_TEXT,
      opacity: "0.6",
      maxWidth: "360px",
      letterSpacing: "0.02em",
    });
    this.root.appendChild(keySectionNote);

    const keyValueEls = {} as Record<KeyBindableAction, HTMLDivElement>;
    for (const action of KEY_BINDABLE_ACTIONS) {
      const { row, valueEl } = this.buildKeyRow(action);
      keyValueEls[action] = valueEl;
      this.root.appendChild(row);
    }
    this.keyValueEls = keyValueEls;

    const keysResetBtn = buildMenuButton("恢復預設按鍵");
    keysResetBtn.dataset["role"] = "keys-reset";
    Object.assign(keysResetBtn.style, { minWidth: "0", padding: "6px 18px", fontSize: "13px" });
    keysResetBtn.addEventListener("click", () => this.onKeyResetCb?.());
    this.root.appendChild(keysResetBtn);

    const backBtn = buildMenuButton("返回");
    backBtn.dataset["role"] = "settings-back";
    backBtn.addEventListener("click", () => this.onBackCb?.());
    this.root.appendChild(backBtn);

    container.appendChild(this.root);
  }

  private buildKeyRow(action: KeyBindableAction): { row: HTMLDivElement; valueEl: HTMLDivElement } {
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", alignItems: "center", gap: "12px" });

    const labelEl = document.createElement("div");
    labelEl.textContent = `${KEY_ACTION_LABELS[action]}：`;
    Object.assign(labelEl.style, {
      minWidth: "150px",
      textAlign: "right",
      fontSize: "14px",
      opacity: "0.85",
      letterSpacing: "0.04em",
    });

    const valueEl = document.createElement("div");
    valueEl.dataset["role"] = `key-${action}-value`;
    valueEl.textContent = keyCodeDisplayName(this.keyBindings[action]);
    Object.assign(valueEl.style, {
      minWidth: "90px",
      fontSize: "15px",
      fontWeight: "700",
      color: COLOR_ACCENT,
    });

    const rebindBtn = document.createElement("button");
    rebindBtn.textContent = "重新綁定";
    rebindBtn.dataset["role"] = `key-${action}-rebind`;
    Object.assign(rebindBtn.style, {
      padding: "6px 14px",
      background: "transparent",
      border: `1px solid ${COLOR_ACCENT}`,
      borderRadius: "4px",
      color: COLOR_TEXT,
      fontSize: "13px",
      cursor: "pointer",
      fontFamily: "system-ui, -apple-system, sans-serif",
    });
    rebindBtn.addEventListener("click", () => this.startCapture(action));

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    row.appendChild(rebindBtn);
    return { row, valueEl };
  }

  /**
   * 進入「請按下新按鍵」擷取態：以 capture 階段（第三參數 true）監聽 window 的下一次 keydown，
   * 確保比 core/input.ts InputManager 的（bubbling 階段）監聽器先攔截到同一次按鍵事件並
   * stopPropagation，避免使用者在設定畫面按下移動／射擊鍵時同時被當成真實遊玩輸入處理
   * （設定畫面開啟時 gameState 為 menu 或 paused，模擬本就不消費 input.state，此處為保守防呆，
   * 避免鍵按住未放開造成 InputManager 內部旗標卡在 true，見 input.ts setBindings 同精神註解）。
   * Esc 取消（不變更任何綁定，還原顯示）；其餘鍵一律回呼 onKeyRebindCb 交由呼叫端決定是否
   * 生效（呼叫端會再呼叫 updateKeyBindingsDisplay 覆蓋回顯示最終結果，含互換連動的另一列）。
   */
  private startCapture(action: KeyBindableAction): void {
    if (this.capturingAction !== null) return; // 已有擷取中，忽略重疊點擊（同一時間僅一項擷取）
    this.capturingAction = action;
    const valueEl = this.keyValueEls[action];
    valueEl.textContent = CAPTURE_PROMPT_TEXT;

    const handler = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener("keydown", handler, true);
      this.capturingAction = null;
      valueEl.textContent = keyCodeDisplayName(this.keyBindings[action]); // 先還原成目前值，成功時下方 onKeyRebindCb 觸發的 updateKeyBindingsDisplay 會再覆蓋成新值
      if (e.code === "Escape") return;
      this.onKeyRebindCb?.(action, e.code);
    };
    window.addEventListener("keydown", handler, true);
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

  /** 使用者成功擷取到一個新按鍵（非 Esc 取消）時觸發，呼叫端應轉交 KeyBindingStore.setBinding
   *  並將結果（含可能的互換）以 updateKeyBindingsDisplay() 回寫本面板（見 main.ts）。 */
  onKeyRebind(cb: (action: KeyBindableAction, code: string) => void): void {
    this.onKeyRebindCb = cb;
  }

  /** 使用者點擊「恢復預設按鍵」時觸發，呼叫端應轉交 KeyBindingStore.resetToDefault 並回寫。 */
  onKeyReset(cb: () => void): void {
    this.onKeyResetCb = cb;
  }

  /** 依最新按鍵映射重新整理六列的顯示文字（main.ts 於 setBinding／resetToDefault 之後呼叫）。
   *  若當下正有動作在擷取中，不覆蓋其「請按下新按鍵」提示（擷取完成後自會以最新值覆蓋）。 */
  updateKeyBindingsDisplay(bindings: Readonly<KeyBindings>): void {
    this.keyBindings = { ...bindings };
    for (const action of KEY_BINDABLE_ACTIONS) {
      if (action === this.capturingAction) continue;
      this.keyValueEls[action].textContent = keyCodeDisplayName(this.keyBindings[action]);
    }
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}

/** 真結局結尾文字（PLAN §4.4：三行，繁體全形標點，極簡；M3 第三階段取代原「垂直切片完成」
 *  的臨時通關畫面）。 */
const ENDING_LINES: readonly string[] = ["核心停止運轉，警報聲漸漸止息。", "生物機械體失去驅動，倒伏於黑暗之中。", "任務完成，你活著走出了這座設施。"];

/**
 * 結局畫面（M2 新增，M3 第三階段改為真結局）：playing → complete（見 game/state.ts）於首領死亡
 * 觸發（取代已移除的暫時終點 endTrigger，見 procgen/level/level.ts 與 main.ts），呈現三行結尾
 * 敘事文字、通關時間與擊殺數，唯一動作是「回主選單」（走 state machine 的 restart 流程，
 * 由 main.ts 負責重建關卡狀態，回到 menu 重新開始完整流程，本次派工規格）。
 */
export class WinScreen {
  private readonly root: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private onReturnToMenuCb: (() => void) | null = null;

  constructor(container: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.id = "p96-win-overlay";
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
      zIndex: "28",
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center",
    });

    const title = document.createElement("div");
    title.textContent = "設施靜默";
    Object.assign(title.style, {
      fontSize: "clamp(26px, 5vw, 42px)",
      fontWeight: "700",
      color: COLOR_ACCENT,
      textShadow: `0 0 24px ${COLOR_ACCENT}`,
    });

    const narrativeEl = document.createElement("div");
    narrativeEl.dataset["role"] = "win-narrative";
    narrativeEl.textContent = ENDING_LINES.join("\n");
    Object.assign(narrativeEl.style, {
      fontSize: "15px",
      color: COLOR_TEXT,
      opacity: "0.85",
      lineHeight: "2",
      whiteSpace: "pre-line",
      maxWidth: "560px",
    });

    this.statsEl = document.createElement("div");
    this.statsEl.dataset["role"] = "win-stats";
    Object.assign(this.statsEl.style, { fontSize: "16px", color: COLOR_TEXT, opacity: "0.85", lineHeight: "1.8" });

    const menuBtn = buildMenuButton("回主選單");
    menuBtn.dataset["role"] = "win-return-menu";
    menuBtn.addEventListener("click", () => this.onReturnToMenuCb?.());

    this.root.appendChild(title);
    this.root.appendChild(narrativeEl);
    this.root.appendChild(this.statsEl);
    this.root.appendChild(menuBtn);
    container.appendChild(this.root);
  }

  onReturnToMenu(cb: () => void): void {
    this.onReturnToMenuCb = cb;
  }

  /** 顯示通關統計：completionSeconds 為離開主選單起算的耗時，kills 為全程累計擊殺數。 */
  show(completionSeconds: number, kills: number): void {
    const minutes = Math.floor(completionSeconds / 60);
    const seconds = Math.floor(completionSeconds % 60);
    const timeText = `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
    this.statsEl.textContent = `通關時間：${timeText}　擊殺數：${kills}`;
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
