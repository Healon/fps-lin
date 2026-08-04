// node:test 純邏輯單元測試：設定的載入／儲存／非法值回退。
// storage 一律注入 MemoryStorage（node:test 環境無穩定的全域 window.localStorage，見
// src/core/settings.ts 檔頭註解），瀏覽器執行期則改用 createBrowserStorage()。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadSettings,
  saveSetting,
  SettingsStore,
  MemoryStorage,
  DEFAULT_SETTINGS,
  SENSITIVITY_MIN,
  SENSITIVITY_MAX,
  VOLUME_MIN,
  VOLUME_MAX,
  FOV_MIN,
  FOV_MAX,
} from "../../src/core/settings.ts";

test("無任何儲存值時，loadSettings 回傳預設值（靈敏度 1.0／音量 80／FOV 90）", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
});

test("儲存合法值後，loadSettings 讀回一致", () => {
  const storage = new MemoryStorage();
  saveSetting(storage, "sensitivity", 1.5);
  saveSetting(storage, "volume", 40);
  saveSetting(storage, "fov", 100);
  assert.deepEqual(loadSettings(storage), { sensitivity: 1.5, volume: 40, fov: 100 });
});

test("非數字（壞字串／NaN／空字串）一律回退預設值", () => {
  const storage = new MemoryStorage();
  storage.setItem("p96.settings.sensitivity", "not-a-number");
  storage.setItem("p96.settings.volume", "NaN");
  storage.setItem("p96.settings.fov", "");
  const settings = loadSettings(storage);
  assert.equal(settings.sensitivity, DEFAULT_SETTINGS.sensitivity);
  assert.equal(settings.volume, DEFAULT_SETTINGS.volume);
  assert.equal(settings.fov, DEFAULT_SETTINGS.fov);
});

test("超出合法範圍的值一律回退預設值，不做 clamp", () => {
  const storage = new MemoryStorage();
  storage.setItem("p96.settings.sensitivity", String(SENSITIVITY_MAX + 10));
  storage.setItem("p96.settings.volume", String(VOLUME_MIN - 1));
  storage.setItem("p96.settings.fov", String(FOV_MAX + 1));
  const settings = loadSettings(storage);
  assert.equal(settings.sensitivity, DEFAULT_SETTINGS.sensitivity);
  assert.equal(settings.volume, DEFAULT_SETTINGS.volume);
  assert.equal(settings.fov, DEFAULT_SETTINGS.fov);
});

test("邊界值（剛好等於 min／max）視為合法，不回退", () => {
  const storage = new MemoryStorage();
  storage.setItem("p96.settings.sensitivity", String(SENSITIVITY_MIN));
  storage.setItem("p96.settings.fov", String(FOV_MAX));
  const settings = loadSettings(storage);
  assert.equal(settings.sensitivity, SENSITIVITY_MIN);
  assert.equal(settings.fov, FOV_MAX);
});

test("SettingsStore.setSensitivity 會 clamp 到合法範圍並持久化", () => {
  const storage = new MemoryStorage();
  const store = new SettingsStore(storage);
  store.setSensitivity(999);
  assert.equal(store.get().sensitivity, SENSITIVITY_MAX);
  assert.equal(loadSettings(storage).sensitivity, SENSITIVITY_MAX);

  store.setSensitivity(-5);
  assert.equal(store.get().sensitivity, SENSITIVITY_MIN);
});

test("SettingsStore.setVolume／setFov 會 clamp 並持久化", () => {
  const storage = new MemoryStorage();
  const store = new SettingsStore(storage);
  store.setVolume(1000);
  assert.equal(store.get().volume, VOLUME_MAX);
  store.setFov(1);
  assert.equal(store.get().fov, FOV_MIN);
  assert.equal(loadSettings(storage).fov, FOV_MIN);
});

test("SettingsStore 建構時會從既有 storage 載入", () => {
  const storage = new MemoryStorage();
  saveSetting(storage, "fov", 105);
  const store = new SettingsStore(storage);
  assert.equal(store.get().fov, 105);
});

test("onChange 監聽者於設定變更時收到最新完整 Settings", () => {
  const storage = new MemoryStorage();
  const store = new SettingsStore(storage);
  let received: unknown = null;
  store.onChange((s) => {
    received = s;
  });
  store.setVolume(50);
  assert.deepEqual(received, { ...DEFAULT_SETTINGS, volume: 50 });
});
