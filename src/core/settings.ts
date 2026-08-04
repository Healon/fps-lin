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
