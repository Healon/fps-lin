// 使用者設定（滑鼠靈敏度／主音量／FOV）：載入、儲存、驗證、套用時的變更通知。
// PLAN §6.1：localStorage 僅存設定，key 命名空間 p96.settings.*。
// 值非法（NaN、超界）一律回退預設值，不做靜默 clamp 修正——壞值必須被拒絕而非悄悄改造成
// 「看似合理」的值，呼應 PLAN §8.1「有值不等於有效」；使用者透過 UI 調整的合法路徑
// （SettingsStore.set*）則會 clamp 到範圍內，兩者職責不同（見下方個別函式註解）。
//
// storage 以 StorageLike 介面注入，讓本檔可脫離瀏覽器 DOM 以 node:test 純函式測試
// （tests/unit/settings.test.ts）；Node 目前對 window.localStorage 無穩定支援，
// 瀏覽器執行期改用 createBrowserStorage() 取得安全包裝過的真正 localStorage。

export interface Settings {
  /** 滑鼠靈敏度倍率，同時作用於方向鍵視角轉速。 */
  sensitivity: number;
  /** 主音量，0 至 100。 */
  volume: number;
  /** 視野角（度）。PLAN §3.2：預設 90，可調 70 至 110。 */
  fov: number;
}

/** 單一設定欄位名稱，供 UI（ui/menu.ts）與 debug hook 型別共用。 */
export type SettingsField = keyof Settings;

export const SENSITIVITY_MIN = 0.5;
export const SENSITIVITY_MAX = 2.0;
export const SENSITIVITY_DEFAULT = 1.0;

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 100;
export const VOLUME_DEFAULT = 80;

export const FOV_MIN = 70;
export const FOV_MAX = 110;
export const FOV_DEFAULT = 90;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sensitivity: SENSITIVITY_DEFAULT,
  volume: VOLUME_DEFAULT,
  fov: FOV_DEFAULT,
});

const STORAGE_KEYS: Readonly<Record<keyof Settings, string>> = {
  sensitivity: "p96.settings.sensitivity",
  volume: "p96.settings.volume",
  fov: "p96.settings.fov",
};

const RANGES: Readonly<Record<keyof Settings, readonly [number, number]>> = {
  sensitivity: [SENSITIVITY_MIN, SENSITIVITY_MAX],
  volume: [VOLUME_MIN, VOLUME_MAX],
  fov: [FOV_MIN, FOV_MAX],
};

/** 與 window.localStorage 相容的最小介面，供測試注入記憶體模擬版本。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 記憶體版 StorageLike：node:test 環境無穩定的全域 localStorage，測試一律注入此類別。 */
export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/**
 * 瀏覽器環境的安全存取包裝：私密瀏覽模式或設定封鎖 localStorage 時，setItem 會拋出例外。
 * 探測失敗就退回記憶體版（本次工作階段暫用，不持久化），不讓設定系統拖垮整個遊戲載入
 * （呼應 PLAN §6.7「無音效裝置不當機」同一防禦精神）。
 */
export function createBrowserStorage(): StorageLike {
  try {
    const probeKey = "p96.settings.__probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch (err) {
    console.warn("[settings] localStorage 無法使用，本次工作階段的設定不會持久化：", err);
    return new MemoryStorage();
  }
}

function clampToRange(value: number, key: keyof Settings): number {
  const [lo, hi] = RANGES[key];
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * 解析單一設定值：storage 內無值、非數字（含 NaN）或超出合法範圍，一律回傳 fallback。
 * 刻意不做 clamp——壞值代表「這筆資料不可信」，回退預設值才是安全的，不是把它硬拉回範圍內
 * 假裝有效（那屬於 SettingsStore.set* 的職責：使用者從 UI 拖出範圍外時才 clamp）。
 */
function parseStoredValue(raw: string | null, key: keyof Settings, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const [lo, hi] = RANGES[key];
  if (n < lo || n > hi) return fallback;
  return n;
}

/** 讀取完整設定，任何一項非法都只回退該項，不影響其餘項目。 */
export function loadSettings(storage: StorageLike): Settings {
  return {
    sensitivity: parseStoredValue(storage.getItem(STORAGE_KEYS.sensitivity), "sensitivity", DEFAULT_SETTINGS.sensitivity),
    volume: parseStoredValue(storage.getItem(STORAGE_KEYS.volume), "volume", DEFAULT_SETTINGS.volume),
    fov: parseStoredValue(storage.getItem(STORAGE_KEYS.fov), "fov", DEFAULT_SETTINGS.fov),
  };
}

/** 寫入單一設定值。呼叫端須先 clamp 到合法範圍（見 SettingsStore.set*），本函式不重複檢查。 */
export function saveSetting(storage: StorageLike, key: keyof Settings, value: number): void {
  storage.setItem(STORAGE_KEYS[key], String(value));
}

// ---- 按鍵重設（M3 第四階段新增，PLAN §9 M3「無障礙選項」之一）----
//
// 可重設的六個動作：前進／後退／左移／右移／射擊／互動。方向鍵視角、數字鍵武器切換、Esc
// 暫停維持固定不可重設（本次派工規格明示），故不在此列。值為 KeyboardEvent.code
// （如 "KeyW"、"Space"），非 event.key，理由同 core/input.ts 既有慣例：code 不受鍵盤配置
// 影響（大小寫、輸入法、Shift 皆不影響 code）。

export type KeyBindableAction = "forward" | "back" | "left" | "right" | "fire" | "interact";

export interface KeyBindings {
  forward: string;
  back: string;
  left: string;
  right: string;
  fire: string;
  interact: string;
}

export const KEY_BINDABLE_ACTIONS: readonly KeyBindableAction[] = ["forward", "back", "left", "right", "fire", "interact"];

export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = Object.freeze({
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  fire: "Space",
  interact: "KeyE",
});

const KEY_BINDING_STORAGE_KEYS: Readonly<Record<KeyBindableAction, string>> = {
  forward: "p96.settings.keys.forward",
  back: "p96.settings.keys.back",
  left: "p96.settings.keys.left",
  right: "p96.settings.keys.right",
  fire: "p96.settings.keys.fire",
  interact: "p96.settings.keys.interact",
};

/** 固定不可重設的 code：方向鍵視角、數字鍵武器切換、Esc 暫停（本次派工規格）。載入與重綁
 *  皆拒絕這些 code 指派給可重設動作，避免一鍵身兼二責的靜默混淆。 */
export const RESERVED_KEY_CODES: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Escape",
]);

/** code 值的最小格式檢查（KeyboardEvent.code 皆為英數字，如 "KeyW"／"Space"／"ShiftLeft"）
 *  加保留碼排除。不做完整白名單比對（code 空間大且會隨鍵盤持續擴充），格式加保留碼已足以
 *  擋下明顯壞值（見 loadKeyBindings 註解：壞值不得進遊戲）。 */
function isValidKeyCode(raw: string | null): raw is string {
  if (raw === null) return false;
  if (!/^[A-Za-z0-9]{1,32}$/.test(raw)) return false;
  if (RESERVED_KEY_CODES.has(raw)) return false;
  return true;
}

function parseStoredKeyValue(raw: string | null, fallback: string): string {
  return isValidKeyCode(raw) ? raw : fallback;
}

/**
 * 讀取完整按鍵映射：先逐項回退非法值（同 loadSettings 慣例，格式不合法或為保留碼者回退該項
 * 預設值），再檢查六項之間是否有重複綁定（同一 code 綁給兩個不同動作）。重複綁定是「整組」
 * 不變量而非單一欄位問題，無法歸咎於哪一項，一律整組回退預設（呼應 PLAN §8.1
 * 「有值不等於有效」：逐項皆為合法 code 字串，但整組語意仍可能無效）。
 */
export function loadKeyBindings(storage: StorageLike): KeyBindings {
  const result = {} as KeyBindings;
  for (const action of KEY_BINDABLE_ACTIONS) {
    result[action] = parseStoredKeyValue(storage.getItem(KEY_BINDING_STORAGE_KEYS[action]), DEFAULT_KEY_BINDINGS[action]);
  }
  const codes = KEY_BINDABLE_ACTIONS.map((a) => result[a]);
  const hasDuplicate = new Set(codes).size !== codes.length;
  if (hasDuplicate) return { ...DEFAULT_KEY_BINDINGS };
  return result;
}

export function saveKeyBinding(storage: StorageLike, action: KeyBindableAction, code: string): void {
  storage.setItem(KEY_BINDING_STORAGE_KEYS[action], code);
}

export type KeyBindingChangeListener = (bindings: Readonly<KeyBindings>) => void;

/**
 * 按鍵映射的執行期容器：建構時載入既有值（含驗證回退）、setBinding 處理衝突互換與持久化、
 * resetToDefault 一鍵恢復。與 SettingsStore 職責對稱但分開成獨立類別（數值 clamp 與按鍵衝突
 * 互換是不同性質的驗證邏輯，合併會讓兩者互相牽扯）。
 */
export class KeyBindingStore {
  private current: KeyBindings;
  private readonly storage: StorageLike;
  private readonly listeners: KeyBindingChangeListener[] = [];

  constructor(storage: StorageLike) {
    this.storage = storage;
    this.current = loadKeyBindings(storage);
  }

  get(): Readonly<KeyBindings> {
    return this.current;
  }

  onChange(listener: KeyBindingChangeListener): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current);
  }

  /**
   * 重新綁定 action 為 code。code 為保留碼（RESERVED_KEY_CODES）時整次呼叫視為無效，不變更
   * 任何綁定，回傳 null。若 code 目前綁在另一個可重設動作上，兩者互換（該動作改用 action
   * 原本的 code，本次派工規格「擷取到的鍵若與其他動作衝突則兩者互換並提示」），回傳被連帶
   * 互換的動作；否則回傳 null。
   */
  setBinding(action: KeyBindableAction, code: string): KeyBindableAction | null {
    if (RESERVED_KEY_CODES.has(code)) return null;
    const previousCode = this.current[action];
    const conflictAction = KEY_BINDABLE_ACTIONS.find((a) => a !== action && this.current[a] === code) ?? null;
    const next: KeyBindings = { ...this.current, [action]: code };
    if (conflictAction) next[conflictAction] = previousCode;
    this.current = next;
    saveKeyBinding(this.storage, action, code);
    if (conflictAction) saveKeyBinding(this.storage, conflictAction, previousCode);
    this.emit();
    return conflictAction;
  }

  /** 恢復全部可重設按鍵為預設值並持久化（本次派工規格「附『恢復預設』按鈕」）。 */
  resetToDefault(): void {
    this.current = { ...DEFAULT_KEY_BINDINGS };
    for (const action of KEY_BINDABLE_ACTIONS) saveKeyBinding(this.storage, action, this.current[action]);
    this.emit();
  }
}

export type SettingsChangeListener = (settings: Readonly<Settings>) => void;

/**
 * 設定的執行期容器：建構時載入既有值、set* 一律 clamp 到合法範圍並立即持久化與通知監聽者。
 * main.ts 透過 onChange（或 set* 呼叫後）把新值轉交給正式 API
 * （renderer.setFov／audio setMasterVolume／player.setSensitivity），本類別本身不碰任何
 * 渲染／音訊／輸入模組，維持單一職責。
 */
export class SettingsStore {
  private current: Settings;
  private readonly storage: StorageLike;
  private readonly listeners: SettingsChangeListener[] = [];

  constructor(storage: StorageLike) {
    this.storage = storage;
    this.current = loadSettings(storage);
  }

  get(): Readonly<Settings> {
    return this.current;
  }

  onChange(listener: SettingsChangeListener): void {
    this.listeners.push(listener);
  }

  private commit(key: keyof Settings, rawValue: number): void {
    const value = clampToRange(rawValue, key);
    this.current = { ...this.current, [key]: value };
    saveSetting(this.storage, key, value);
    for (const listener of this.listeners) listener(this.current);
  }

  setSensitivity(value: number): void {
    this.commit("sensitivity", value);
  }

  setVolume(value: number): void {
    this.commit("volume", value);
  }

  setFov(value: number): void {
    this.commit("fov", value);
  }
}
