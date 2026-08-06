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
  loadKeyBindings,
  saveKeyBinding,
  KeyBindingStore,
  DEFAULT_KEY_BINDINGS,
  KEY_BINDABLE_ACTIONS,
  RESERVED_KEY_CODES,
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

// ---- 按鍵重設（M3 第四階段新增）----

test("無任何儲存值時，loadKeyBindings 回傳預設按鍵映射", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadKeyBindings(storage), DEFAULT_KEY_BINDINGS);
});

test("儲存合法值後，loadKeyBindings 讀回一致", () => {
  const storage = new MemoryStorage();
  saveKeyBinding(storage, "fire", "KeyF");
  saveKeyBinding(storage, "interact", "KeyG");
  const bindings = loadKeyBindings(storage);
  assert.equal(bindings.fire, "KeyF");
  assert.equal(bindings.interact, "KeyG");
  assert.equal(bindings.forward, DEFAULT_KEY_BINDINGS.forward); // 未寫入者維持預設

});

test("格式不合法的值（空字串／含特殊符號／過長）該欄回退預設值", () => {
  const storage = new MemoryStorage();
  storage.setItem("p96.settings.keys.fire", "");
  storage.setItem("p96.settings.keys.interact", "Key-E!");
  storage.setItem("p96.settings.keys.forward", "A".repeat(40));
  const bindings = loadKeyBindings(storage);
  assert.equal(bindings.fire, DEFAULT_KEY_BINDINGS.fire);
  assert.equal(bindings.interact, DEFAULT_KEY_BINDINGS.interact);
  assert.equal(bindings.forward, DEFAULT_KEY_BINDINGS.forward);
});

test("保留碼（方向鍵視角／數字鍵武器／Esc）不可作為可重設動作的值，該欄回退預設值", () => {
  for (const reserved of RESERVED_KEY_CODES) {
    const storage = new MemoryStorage();
    storage.setItem("p96.settings.keys.fire", reserved);
    const bindings = loadKeyBindings(storage);
    assert.equal(bindings.fire, DEFAULT_KEY_BINDINGS.fire, `保留碼 ${reserved} 不應被接受`);
  }
});

test("六項之間出現重複綁定（同一 code 綁給兩個動作）時，整組回退預設", () => {
  const storage = new MemoryStorage();
  // forward 與 back 都被（不合規地）寫成同一個 code。
  saveKeyBinding(storage, "forward", "KeyJ");
  saveKeyBinding(storage, "back", "KeyJ");
  saveKeyBinding(storage, "fire", "KeyF"); // 這項單獨看合法，但整組仍因重複而全部回退
  const bindings = loadKeyBindings(storage);
  assert.deepEqual(bindings, DEFAULT_KEY_BINDINGS);
});

test("KeyBindingStore 建構時會從既有 storage 載入", () => {
  const storage = new MemoryStorage();
  saveKeyBinding(storage, "fire", "KeyF");
  const store = new KeyBindingStore(storage);
  assert.equal(store.get().fire, "KeyF");
});

test("KeyBindingStore.setBinding：無衝突時直接更新單一動作並持久化", () => {
  const storage = new MemoryStorage();
  const store = new KeyBindingStore(storage);
  const conflict = store.setBinding("fire", "KeyF");
  assert.equal(conflict, null);
  assert.equal(store.get().fire, "KeyF");
  assert.equal(loadKeyBindings(storage).fire, "KeyF");
});

test("KeyBindingStore.setBinding：目標 code 已被其他動作使用時，兩者互換", () => {
  const storage = new MemoryStorage();
  const store = new KeyBindingStore(storage);
  // interact 預設 KeyE；把 forward 改綁成 KeyE（interact 目前所在的 code）。
  const conflict = store.setBinding("forward", "KeyE");
  assert.equal(conflict, "interact");
  assert.equal(store.get().forward, "KeyE");
  assert.equal(store.get().interact, DEFAULT_KEY_BINDINGS.forward); // interact 拿走 forward 原本的 KeyW
  // 兩者皆已持久化。
  assert.equal(loadKeyBindings(storage).forward, "KeyE");
  assert.equal(loadKeyBindings(storage).interact, DEFAULT_KEY_BINDINGS.forward);
});

test("KeyBindingStore.setBinding：保留碼（方向鍵／數字鍵／Esc）一律拒絕，不變更任何綁定", () => {
  const storage = new MemoryStorage();
  const store = new KeyBindingStore(storage);
  const before = store.get();
  const conflict = store.setBinding("fire", "ArrowUp");
  assert.equal(conflict, null);
  assert.deepEqual(store.get(), before);
});

test("KeyBindingStore.resetToDefault：恢復全部預設並持久化", () => {
  const storage = new MemoryStorage();
  const store = new KeyBindingStore(storage);
  store.setBinding("fire", "KeyF");
  store.setBinding("interact", "KeyG");
  store.resetToDefault();
  assert.deepEqual(store.get(), DEFAULT_KEY_BINDINGS);
  assert.deepEqual(loadKeyBindings(storage), DEFAULT_KEY_BINDINGS);
});

test("KeyBindingStore.onChange：setBinding 與 resetToDefault 皆會通知監聽者最新完整映射", () => {
  const storage = new MemoryStorage();
  const store = new KeyBindingStore(storage);
  let received: unknown = null;
  store.onChange((b) => {
    received = b;
  });
  store.setBinding("fire", "KeyF");
  assert.equal((received as { fire: string }).fire, "KeyF");
  store.resetToDefault();
  assert.deepEqual(received, DEFAULT_KEY_BINDINGS);
});

test("KEY_BINDABLE_ACTIONS 恰為六個可重設動作，且與 DEFAULT_KEY_BINDINGS 欄位一致", () => {
  assert.deepEqual(
    [...KEY_BINDABLE_ACTIONS].sort(),
    ["back", "fire", "forward", "interact", "left", "right"].sort(),
  );
  for (const action of KEY_BINDABLE_ACTIONS) {
    assert.equal(typeof DEFAULT_KEY_BINDINGS[action], "string");
  }
});
