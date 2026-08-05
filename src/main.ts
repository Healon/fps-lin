// boot 流程：生成關卡（含門／撿取物／敵人配置）→ 生成材質、模型、武器 viewmodel、門板與撿取物
// props → 初始化 GL 與 buffer → 設 window.__p96 → 啟動迴圈。
// 渲染迴圈不等點擊就開跑（點擊只負責 pointer lock 與音訊手勢），讓自動化測試不需手勢即可驗 frames。
// 任何 boot 或執行期錯誤一律顯示在 overlay 上，禁止靜默失敗。
//
// 2026-08-04（M2 第二階段）：垂直切片主體。取代 M0/M1 的單一測試房（procgen/level/room.ts 已
// 整檔刪除，改用 procgen/level/level.ts 的 generateLevel()：區域 A 甦醒室 → 通道 A-B → 區域 B
// 維修走廊 → 門 B → 區域 C 熔爐大廳（伏擊）→ 終點門 → 終點觸發區）。新增：門系統
// （game/doors.ts，依條件加玩家靠近距離自動滑開）、撿取系統（武器／彈藥／醫療包）、散射槍
// （game/shotgun.ts）與武器庫存（game/inventory.ts，撿取前赤手空拳、未擁有武器不可切換）、
// 通關畫面（ui/menu.ts WinScreen，走 game/state.ts 新增的 "complete" 狀態）。
// 舊有 M1 特效系統（後座／槍口閃光／單發 tracer／火花，見 game/effects.ts）沿用於脈衝手槍；
// 散射槍因單次開火即產生 6 珠命中，改用本檔內的多筆 tracer／spark 陣列（見下方
// SHOTGUN_TRACER_LIFETIME 區塊），不擴充 effects.ts 的單槽狀態機。

import { generateLevel, DOOR_OPEN_SLIDE_DISTANCE } from "./procgen/level/level.ts";
import type { PickupDef, PickupKind, EnemyArea } from "./procgen/level/level.ts";
import type { Aabb } from "./procgen/level/level.ts";
import { TEXTURE_SIZE } from "./procgen/texture/noise.ts";
import { generateFloorFlagstoneTexture } from "./procgen/texture/flagstone.ts";
import { generateCastleWallTexture } from "./procgen/texture/castle.ts";
import { generateCrawlerMesh } from "./procgen/mesh/crawler.ts";
import { generatePistolMesh } from "./procgen/mesh/pistol.ts";
import { generateShotgunMesh } from "./procgen/mesh/shotgun.ts";
import { generateDoorMesh } from "./procgen/mesh/door.ts";
import { generateAmmoBoxMesh, generateMedkitBoxMesh } from "./procgen/mesh/pickup-props.ts";
import { Renderer } from "./gfx/renderer.ts";
import type { EnemyInstance } from "./gfx/renderer.ts";
import { InputManager } from "./core/input.ts";
import { GameLoop } from "./core/loop.ts";
import { PlayerController, PITCH_LIMIT } from "./game/player.ts";
import {
  forwardFromYawPitch,
  yawPitchFromDirection,
  translationMat4,
  translationRotationYMat4,
  rotationYMat4,
  trsMat4,
  multiply,
  identity,
  normalizeVec3,
  subVec3,
  type Vec3,
  type Mat4,
} from "./core/math.ts";
import { Crawler } from "./game/enemy.ts";
import type { EnemyState } from "./game/enemy.ts";
import type { FireResult, WeaponId } from "./game/weapons.ts";
import { PULSE_PISTOL_MAGAZINE } from "./game/weapons.ts";
import type { ScatterFireResult } from "./game/shotgun.ts";
import { SCATTER_MAGAZINE } from "./game/shotgun.ts";
import { WeaponInventory } from "./game/inventory.ts";
import { Combat, PLAYER_MAX_HP } from "./game/combat.ts";
import { Recoil, MuzzleFlashEffect, TracerEffect, SparkEffect, WeaponSwitchEffect } from "./game/effects.ts";
import { DoorSystem } from "./game/doors.ts";
import type { DoorRuntimeContext } from "./game/doors.ts";
import { GameStateMachine } from "./game/state.ts";
import type { GameState } from "./game/state.ts";
import { SettingsStore, createBrowserStorage } from "./core/settings.ts";
import { Overlay } from "./ui/overlay.ts";
import { Hud } from "./ui/hud.ts";
import { PauseMenu, SettingsPanel, WinScreen } from "./ui/menu.ts";
import {
  resumeAudioOnGesture,
  playPlayerHurt,
  playRespawn,
  playPickup,
  playSwitch,
  playDoorMove,
  setMasterVolume,
} from "./audio/synth.ts";
import { MusicSystem } from "./audio/music.ts";
// window.__p96 的型別宣告見 ./types/p96-global.d.ts（ambient 全域宣告，tsconfig include 自動生效，
// 不需 import；main.ts 為 esbuild bundle 的實際進入點，避免 import 一個 .d.ts 造成 bundler 誤解析）。

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.message}\n${err.stack ?? ""}`;
  return String(err);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// viewmodel 錨定位置（view-space：+X 右、+Y 上、-Z 前方），畫面右下角穩定不隨視角浮動。
const VIEWMODEL_BASE_OFFSET: Vec3 = { x: 0.16, y: -0.13, z: -0.32 };
const RECOIL_KICK_Y = 0.045; // 後座往上
const RECOIL_KICK_Z = 0.06; // 後座往後（朝玩家）
const WEAPON_SWITCH_DIP_Y = 0.12; // 武器切換下收幅度

const MUZZLE_FLASH_HALF_SIZE = 0.045;
const MUZZLE_FLASH_COLOR: [number, number, number, number] = [0.85, 0.98, 1.0, 0.9]; // 青白
const TRACER_COLOR: [number, number, number, number] = [0.35, 0.88, 1.0, 0.85]; // 能源青
// 警示橘偏白熾亮（比敵人自身的警示橘 #FF5A26 更亮更白），命中牆面則用暗一階琥珀。
const SPARK_COLOR_ENEMY: [number, number, number] = [1.0, 0.62, 0.35];
const SPARK_COLOR_WALL: [number, number, number] = [0.55, 0.36, 0.15];
const SPARK_COUNT = 6;
const SPARK_JITTER = 0.08; // m

const PICKUP_RADIUS = 0.8; // m，PLAN 本次派工規格：走近 0.8m 自動拾取
const AMMO_PISTOL_PICKUP_AMOUNT = 24;
const AMMO_SHOTGUN_PICKUP_AMOUNT = 12;
const MEDKIT_HEAL_AMOUNT = 25;

const PICKUP_BOB_AMPLITUDE = 0.06;
const PICKUP_BOB_SPEED = 1.6; // rad/s
const PICKUP_ROTATE_SPEED = 1.1; // rad/s
const WEAPON_PICKUP_SCALE = 2.4;
const WEAPON_PICKUP_HEIGHT = 1.0; // 地面上方懸浮高度
const PROP_PICKUP_HEIGHT = 0.75;

const SHOTGUN_TRACER_LIFETIME = 0.06;
const SHOTGUN_SPARK_LIFETIME = 0.15;

/** 由 view-space 偏移（viewmodel 錨定慣例）換算世界座標，供 tracer 起點等視覺用途。 */
function viewOffsetToWorld(eye: Vec3, yaw: number, pitch: number, offset: Vec3): Vec3 {
  const forward = forwardFromYawPitch(yaw, pitch);
  const right: Vec3 = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  return {
    x: eye.x + right.x * offset.x + up.x * offset.y - forward.x * offset.z,
    y: eye.y + right.y * offset.x + up.y * offset.y - forward.y * offset.z,
    z: eye.z + right.z * offset.x + up.z * offset.y - forward.z * offset.z,
  };
}

/** 建一個面向 view-space 相機的平面 quad（三角形 x2）的 FX 頂點資料（位置＋顏色）。 */
function buildQuadVertices(center: Vec3, halfSize: number, color: [number, number, number, number]): Float32Array {
  const [r, g, b, a] = color;
  const offsets: [number, number][] = [
    [-halfSize, -halfSize],
    [halfSize, -halfSize],
    [halfSize, halfSize],
    [-halfSize, -halfSize],
    [halfSize, halfSize],
    [-halfSize, halfSize],
  ];
  const verts: number[] = [];
  for (const [dx, dy] of offsets) {
    verts.push(center.x + dx, center.y + dy, center.z, r, g, b, a);
  }
  return new Float32Array(verts);
}

function buildTracerVertices(origin: Vec3, hitPoint: Vec3): Float32Array {
  const [r, g, b, a] = TRACER_COLOR;
  return new Float32Array([origin.x, origin.y, origin.z, r, g, b, a, hitPoint.x, hitPoint.y, hitPoint.z, r, g, b, a]);
}

/** 多筆彈道 tracer 一次組成單一 LINES 頂點緩衝（散射槍每次開火 6 珠共用一次 renderFx 呼叫）。 */
function buildMultiTracerVertices(segments: { origin: Vec3; hitPoint: Vec3 }[]): Float32Array {
  const [r, g, b, a] = TRACER_COLOR;
  const verts: number[] = [];
  for (const seg of segments) {
    verts.push(seg.origin.x, seg.origin.y, seg.origin.z, r, g, b, a, seg.hitPoint.x, seg.hitPoint.y, seg.hitPoint.z, r, g, b, a);
  }
  return new Float32Array(verts);
}

function buildSparkVertices(point: Vec3, offsets: Vec3[], kind: "enemy" | "wall", alpha: number): Float32Array {
  const [r, g, b] = kind === "enemy" ? SPARK_COLOR_ENEMY : SPARK_COLOR_WALL;
  const verts: number[] = [];
  for (const o of offsets) {
    verts.push(point.x + o.x, point.y + o.y, point.z + o.z, r, g, b, alpha);
  }
  return new Float32Array(verts);
}

/** 多個命中點各畫一個點（散射槍多珠命中回饋），不做每點抖動叢集（時間預算考量，一點足以標示命中位置）。 */
function buildMultiSparkVertices(hits: { point: Vec3; kind: "enemy" | "wall" }[], alpha: number): Float32Array {
  const verts: number[] = [];
  for (const h of hits) {
    const [r, g, b] = h.kind === "enemy" ? SPARK_COLOR_ENEMY : SPARK_COLOR_WALL;
    verts.push(h.point.x, h.point.y, h.point.z, r, g, b, alpha);
  }
  return new Float32Array(verts);
}

function pointInAabb(p: Vec3, aabb: Aabb): boolean {
  return p.x >= aabb.min.x && p.x <= aabb.max.x && p.y >= aabb.min.y && p.y <= aabb.max.y && p.z >= aabb.min.z && p.z <= aabb.max.z;
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function boot(): void {
  const overlay = new Overlay();
  const hud = new Hud();
  const pauseMenu = new PauseMenu();
  const winScreen = new WinScreen();
  const settingsStore = new SettingsStore(createBrowserStorage());
  const settingsPanel = new SettingsPanel(settingsStore.get());
  const gameState = new GameStateMachine();
  let loop: GameLoop | null = null;

  /**
   * 依目前狀態同步顯示哪個 UI 面板：唯一的顯示邏輯來源，任何狀態轉移（正常操作或
   * __p96.debug.setState() 測試切態）一律經此函式生效。complete 狀態的 WinScreen 內容
   * （時間／擊殺數）由 triggerLevelComplete() 於觸發當下另行寫入，本函式只管顯隱切換。
   */
  function syncUiForState(state: GameState): void {
    if (state === "playing") {
      overlay.hide();
      pauseMenu.hide();
      settingsPanel.hide();
      winScreen.hide();
      overlay.showCrosshair();
    } else if (state === "paused") {
      pauseMenu.show();
      overlay.hideCrosshair();
    } else if (state === "complete") {
      overlay.hide();
      pauseMenu.hide();
      settingsPanel.hide();
      overlay.hideCrosshair();
      // winScreen 本身的 show() 已由 triggerLevelComplete／debug.forceComplete 呼叫，這裡不重複顯示。
    } else {
      overlay.show();
      overlay.hideCrosshair();
      winScreen.hide();
      pauseMenu.hide();
      settingsPanel.hide();
    }
  }
  gameState.onChange((next) => syncUiForState(next));
  syncUiForState(gameState.state); // 初始畫面＝menu：顯示主選單、隱藏準星

  try {
    const canvas = document.getElementById("glcanvas") as HTMLCanvasElement | null;
    if (!canvas) throw new Error("找不到 #glcanvas 元素。");

    // 1. CPU 生成關卡資料（純決定性：碰撞 AABB、門、撿取物、敵人配置、levelHash）
    const genStart = performance.now();
    const level = generateLevel();

    // 2. 生成材質、模型、武器 viewmodel、門板與撿取物 props（外觀，CPU 決定性但非玩法決定性鐵則要求範圍）
    const floorTexture = generateFloorFlagstoneTexture(TEXTURE_SIZE);
    const wallTexture = generateCastleWallTexture(TEXTURE_SIZE);
    const crawlerMesh = generateCrawlerMesh();
    const pistolMesh = generatePistolMesh();
    const shotgunMesh = generateShotgunMesh();
    const doorMesh = generateDoorMesh();
    const ammoBoxMesh = generateAmmoBoxMesh();
    const medkitBoxMesh = generateMedkitBoxMesh();
    const genElapsedMs = performance.now() - genStart;
    console.log(`[perf] 關卡與外觀生成耗時 ${genElapsedMs.toFixed(2)}ms（預算 5000ms，上限 15000ms，PLAN §7.4）`);

    // 3. 初始化 WebGL2 與 buffer
    const renderer = new Renderer(canvas);
    renderer.setFov(settingsStore.get().fov); // 套用已儲存（或預設）的 FOV，正式 API（非改內部常數）
    renderer.uploadFloorGeometry(level.floorVertices, level.floorIndices);
    renderer.uploadFloorTexture(floorTexture.size, floorTexture.pixels);
    renderer.uploadWallGeometry(level.wallVertices, level.wallIndices);
    renderer.uploadWallTexture(wallTexture.size, wallTexture.pixels);
    renderer.uploadCeilingGeometry(level.ceilingVertices, level.ceilingIndices);
    renderer.uploadEnemyGeometry(crawlerMesh.vertices, crawlerMesh.indices);
    renderer.uploadViewmodelGeometry(pistolMesh.vertices, pistolMesh.indices);
    renderer.uploadShotgunViewmodelGeometry(shotgunMesh.vertices, shotgunMesh.indices);
    renderer.uploadPropGeometry("door", doorMesh.vertices, doorMesh.indices);
    renderer.uploadPropGeometry("pickup-pistol", pistolMesh.vertices, pistolMesh.indices);
    renderer.uploadPropGeometry("pickup-shotgun", shotgunMesh.vertices, shotgunMesh.indices);
    renderer.uploadPropGeometry("pickup-ammo", ammoBoxMesh.vertices, ammoBoxMesh.indices);
    renderer.uploadPropGeometry("pickup-medkit", medkitBoxMesh.vertices, medkitBoxMesh.indices);

    const player = new PlayerController(level.playerSpawn);
    player.setSensitivity(settingsStore.get().sensitivity); // 正式 API，同時作用於方向鍵轉速
    const inventory = new WeaponInventory();
    const combat = new Combat();
    const doorSystem = new DoorSystem(level.doors);
    doorSystem.onOpenStart(() => playDoorMove());

    let nextEnemyId = 0;
    function spawnAreaEnemies(area: EnemyArea, initialState: EnemyState): Crawler[] {
      return level.enemySpawns.filter((e) => e.area === area).map((e) => new Crawler(nextEnemyId++, e.pos, initialState, e.area));
    }
    let enemies: Crawler[] = spawnAreaEnemies("B", "idle");
    let ambushTriggered = false;

    interface PickupRuntime {
      def: PickupDef;
      collected: boolean;
    }
    let pickupRuntimes: PickupRuntime[] = level.pickups.map((def) => ({ def, collected: false }));

    let elapsedSeconds = 0;
    let killCount = 0;
    let runStartSeconds: number | null = null;

    /** 目前計入碰撞的清單：靜態關卡幾何加尚未完全開啟的門（每次呼叫即時計算，供玩家移動、
     *  敵人移動與視線、武器 raycast 共用；門數量極小，逐次重算成本可忽略）。 */
    function activeColliders(): Aabb[] {
      return [...level.colliders, ...doorSystem.activeColliders()];
    }

    setMasterVolume(settingsStore.get().volume); // 正式 API；可在 AudioContext 建立前呼叫（見 synth.ts）

    // M2 第三階段：雙態程序化音樂系統（PLAN §6.5），依 gameState 四態驅動起停與 ducking
    // （見 audio/music.ts 類別註解）；playing 狀態下的 explore／combat 偵測見下方主迴圈。
    const music = new MusicSystem();
    gameState.onChange((next) => music.onGameStateChange(next));

    // 射擊視覺回饋狀態機（脈衝手槍沿用 M1 單槽狀態機，見 game/effects.ts）
    const recoil = new Recoil();
    const muzzleFlash = new MuzzleFlashEffect();
    const tracer = new TracerEffect();
    const spark = new SparkEffect();
    const weaponSwitchFx = new WeaponSwitchEffect();
    let sparkJitterOffsets: Vec3[] = [];
    let debugFreezeFx = false;

    // 散射槍多珠 tracer／spark（見檔頭註解：單槽狀態機無法容納一次 6 珠，改用陣列＋計時器）。
    let shotgunTracerElapsed = SHOTGUN_TRACER_LIFETIME;
    let shotgunTracerData: { origin: Vec3; hitPoint: Vec3 }[] = [];
    let shotgunSparkElapsed = SHOTGUN_SPARK_LIFETIME;
    let shotgunSparkData: { point: Vec3; kind: "enemy" | "wall" }[] = [];

    const input = new InputManager(canvas, (locked) => {
      // Esc 或其他方式退出 pointer lock：只有在「正在遊玩」時才視為暫停操作；menu 狀態下
      // （尚未鎖定過）不會觸發（見 core/input.ts：locked 由 true→false 才會呼叫本callback）。
      if (!locked && gameState.state === "playing") {
        gameState.pause();
      }
    });

    overlay.onStart(() => {
      // 每次「點擊進入」（含首次開始與通關後返回主選單再開始）一律先從種子完整重建，
      // 確保每輪都是乾淨的完整流程（本次派工規格：「回主選單後可重新開始完整流程」）。
      resetLevelState({ resetCombat: true, playSound: false });
      // 先確保 AudioContext 建立並 resume（本次點擊即使用者手勢）：下一行 gameState.start()
      // 會同步觸發 music.onGameStateChange("playing")→music.start()，須確保屆時 ctx 已可用
      // （M2 第三階段音樂系統，見 audio/music.ts）。
      resumeAudioOnGesture();
      gameState.start(); // menu → playing（syncUiForState 會收起主選單、顯示準星）
      input.requestPointerLock();
    });

    overlay.onSettings(() => {
      overlay.hide();
      settingsPanel.show();
    });

    pauseMenu.onResume(() => {
      gameState.resume(); // paused → playing
      input.requestPointerLock();
    });

    pauseMenu.onSettings(() => {
      pauseMenu.hide();
      settingsPanel.show();
    });

    pauseMenu.onRestart(() => {
      resetLevelState({ resetCombat: true, playSound: false });
      gameState.restart(); // paused → playing，從種子完整重建（重建動作見 resetLevelState）
      input.requestPointerLock();
    });

    winScreen.onReturnToMenu(() => {
      gameState.setState("menu");
    });

    settingsPanel.onBack(() => {
      settingsPanel.hide();
      // 依「目前未變的」gameState 重新顯示正確的底層選單（menu 或 paused），
      // 兩個入口共用同一份返回邏輯，不需額外追蹤「從哪裡打開設定」。
      syncUiForState(gameState.state);
    });

    settingsPanel.onChange((field, value) => {
      if (field === "sensitivity") {
        settingsStore.setSensitivity(value);
        player.setSensitivity(settingsStore.get().sensitivity);
      } else if (field === "volume") {
        settingsStore.setVolume(value);
        setMasterVolume(settingsStore.get().volume);
      } else if (field === "fov") {
        settingsStore.setFov(value);
        renderer.setFov(settingsStore.get().fov);
      }
    });

    /** 對玩家造成傷害的共用路徑：命中即播放受傷音效（供敵人近戰與 debug hook 共用）。 */
    function applyDamageToPlayer(amount: number): boolean {
      const applied = combat.damagePlayer(amount);
      if (applied) playPlayerHurt();
      return applied;
    }

    /** 觸發區域 C 伏擊：出生即直接進 chase（跳過 idle 偵測，direct aggro，本次派工規格）。 */
    function triggerAmbush(): void {
      if (ambushTriggered) return;
      ambushTriggered = true;
      enemies = enemies.concat(spawnAreaEnemies("C", "chase"));
    }

    /** 撿取生效：套用對應效果、播音效、顯示 HUD toast；散射槍額外觸發伏擊。 */
    function collectPickup(pr: PickupRuntime): void {
      pr.collected = true;
      playPickup();
      switch (pr.def.kind) {
        case "weapon-pistol":
          inventory.give("pistol");
          hud.showToast("拾取脈衝手槍");
          break;
        case "weapon-shotgun":
          inventory.give("shotgun");
          hud.showToast("拾取散射槍");
          triggerAmbush();
          break;
        case "ammo-pistol":
          inventory.addAmmo("pistol", AMMO_PISTOL_PICKUP_AMOUNT);
          hud.showToast(`拾取彈藥 +${AMMO_PISTOL_PICKUP_AMOUNT}`);
          break;
        case "ammo-shotgun":
          inventory.addAmmo("shotgun", AMMO_SHOTGUN_PICKUP_AMOUNT);
          hud.showToast(`拾取彈藥 +${AMMO_SHOTGUN_PICKUP_AMOUNT}`);
          break;
        case "medkit": {
          const healed = combat.heal(MEDKIT_HEAL_AMOUNT);
          hud.showToast(`生命 +${healed}`);
          break;
        }
      }
    }

    function grantWeaponDebug(id: WeaponId): void {
      const kind: PickupKind = id === "pistol" ? "weapon-pistol" : "weapon-shotgun";
      const pr = pickupRuntimes.find((p) => p.def.kind === kind && !p.collected);
      if (pr) {
        collectPickup(pr);
        return;
      }
      inventory.give(id);
      if (id === "shotgun") triggerAmbush();
    }

    /**
     * 共用開火路徑：依 inventory.current 決定驅動哪把武器，回傳是否真的開火。
     * 供真實輸入路徑（input.firing 且狀態為 playing）與 debug.fire() 共用；debug 呼叫時
     * activeColliders()／enemies 皆與遊戲狀態無關，天然可在任何狀態下直接生效。
     */
    function performFire(): boolean {
      const current = inventory.current;
      if (!current) return false;
      const eye = player.getEyePosition();
      const forward = forwardFromYawPitch(player.yaw, player.pitch);
      const colliders = activeColliders();

      if (current === "pistol") {
        const result = inventory.pistol.tryFire(eye, forward, colliders, enemies);
        handleFireResult(result);
        return result.fired;
      }
      const result = inventory.shotgun.tryFire(eye, forward, colliders, enemies);
      handleShotgunFireResult(result);
      return result.fired;
    }

    /** 脈衝手槍開火視覺回饋（沿用 M1 單槽特效狀態機）。 */
    function handleFireResult(result: FireResult): void {
      if (result.died) killCount++;
      if (!result.fired || !result.hitPoint) return;

      recoil.trigger();
      muzzleFlash.trigger();

      const muzzleWorld = viewOffsetToWorld(player.getEyePosition(), player.yaw, player.pitch, {
        x: VIEWMODEL_BASE_OFFSET.x + pistolMesh.muzzleLocal.x,
        y: VIEWMODEL_BASE_OFFSET.y + pistolMesh.muzzleLocal.y,
        z: VIEWMODEL_BASE_OFFSET.z + pistolMesh.muzzleLocal.z,
      });
      tracer.trigger({ origin: muzzleWorld, hitPoint: result.hitPoint });

      if (result.hitKind !== "none") {
        sparkJitterOffsets = Array.from({ length: SPARK_COUNT }, () => ({
          x: (Math.random() * 2 - 1) * SPARK_JITTER,
          y: (Math.random() * 2 - 1) * SPARK_JITTER,
          z: (Math.random() * 2 - 1) * SPARK_JITTER,
        }));
        spark.trigger({ point: result.hitPoint, kind: result.hitKind === "enemy" ? "enemy" : "wall" });
      }
    }

    /** 散射槍開火視覺回饋：6 珠一次觸發，改用本檔的多筆 tracer／spark 陣列（見檔頭註解）。 */
    function handleShotgunFireResult(result: ScatterFireResult): void {
      for (const p of result.pellets) if (p.died) killCount++;
      if (!result.fired) return;

      recoil.trigger();
      muzzleFlash.trigger();

      const muzzleWorld = viewOffsetToWorld(player.getEyePosition(), player.yaw, player.pitch, {
        x: VIEWMODEL_BASE_OFFSET.x + shotgunMesh.muzzleLocal.x,
        y: VIEWMODEL_BASE_OFFSET.y + shotgunMesh.muzzleLocal.y,
        z: VIEWMODEL_BASE_OFFSET.z + shotgunMesh.muzzleLocal.z,
      });
      shotgunTracerData = result.pellets.map((p) => ({ origin: muzzleWorld, hitPoint: p.hitPoint }));
      shotgunTracerElapsed = 0;

      const hitPellets = result.pellets.filter((p) => p.hitKind !== "none");
      if (hitPellets.length > 0) {
        shotgunSparkData = hitPellets.map((p) => ({ point: p.hitPoint, kind: (p.hitKind === "enemy" ? "enemy" : "wall") as "enemy" | "wall" }));
        shotgunSparkElapsed = 0;
      }
    }

    function triggerLevelComplete(): void {
      if (gameState.state !== "playing") return;
      const completionSeconds = runStartSeconds !== null ? elapsedSeconds - runStartSeconds : elapsedSeconds;
      winScreen.show(completionSeconds, killCount);
      gameState.complete();
    }

    /**
     * 重建關卡執行期狀態：玩家、敵人、門、撿取物、武器庫存一律從種子重建。
     * resetCombat＝true 時額外硬重置戰鬥狀態與全程統計（HP／無敵／死亡旗標／擊殺數／通關計時，
     * 供暫停選單「重新開始」與主選單「開始」使用）；自然死亡重生路徑（下方 combat.update()
     * 觸發）已由 Combat.update() 自行處理 HP／死亡旗標重置，且擊殺數與計時「全程累計」不應
     * 因死亡而歸零（本次派工規格），故該路徑傳 resetCombat:false。
     */
    function resetLevelState(opts: { resetCombat: boolean; playSound: boolean }): void {
      player.position = { ...level.playerSpawn };
      player.yaw = 0;
      player.pitch = 0;
      player.velocityY = 0;
      player.grounded = false;
      nextEnemyId = 0;
      enemies = spawnAreaEnemies("B", "idle");
      ambushTriggered = false;
      inventory.reset();
      doorSystem.reset();
      pickupRuntimes = level.pickups.map((def) => ({ def, collected: false }));
      if (opts.resetCombat) {
        combat.reset();
        killCount = 0;
        runStartSeconds = elapsedSeconds;
      }
      if (opts.playSound) playRespawn();
    }

    // 4. 供 Playwright 與手動驗收讀取／操控的全域 debug hooks
    window.__p96 = {
      ready: true,
      frames: 0,
      levelHash: level.levelHash,
      get gameState() {
        return gameState.state;
      },
      enemiesAlive: () => enemies.filter((e) => e.state !== "dead").length,
      playerHp: () => combat.playerHp,
      ammo: () => inventory.ammo(),
      currentWeapon: () => inventory.current,
      kills: () => killCount,
      fire: () => {
        // debug 手段：任何遊戲狀態下都直接生效，繞過真實輸入路徑的狀態閘（本次派工規格）。
        return performFire();
      },
      damagePlayer: (amount: number) => applyDamageToPlayer(amount),
      aimAt: (enemyIndex: number) => {
        const alive = enemies.filter((e) => e.state !== "dead");
        const target = alive[enemyIndex];
        if (!target) return false;
        const eye = player.getEyePosition();
        const dir = normalizeVec3(subVec3(target.getCenter(), eye));
        const { yaw, pitch } = yawPitchFromDirection(dir);
        player.yaw = yaw;
        player.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
        return true;
      },
      debug: {
        // 驗收截圖用：凍結射擊特效與命中回饋計時器，方便從容截圖；預設關閉，不影響正常遊玩。
        setFreezeFx: (enabled: boolean) => {
          debugFreezeFx = enabled;
        },
        teleportPlayer: (pos: Vec3) => {
          player.position = { ...pos };
        },
        getPlayerPosition: () => ({ x: player.position.x, y: player.position.y, z: player.position.z }),
        pickupsRemaining: () => pickupRuntimes.filter((p) => !p.collected).map((p) => ({ kind: p.def.kind, pos: p.def.pos })),
        lookAt: (target: Vec3) => {
          const eye = player.getEyePosition();
          const dir = normalizeVec3(subVec3(target, eye));
          const { yaw, pitch } = yawPitchFromDirection(dir);
          player.yaw = yaw;
          player.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
        },
        enemyTransforms: () =>
          enemies
            .filter((e) => e.state !== "dead")
            .map((e) => ({ x: e.position.x, y: e.position.y, z: e.position.z, yaw: e.yaw, state: e.state })),
        setState: (state: GameState) => gameState.setState(state),
        getSettings: () => settingsStore.get(),
        getFov: () => renderer.getFov(),
        grantWeapon: (id: WeaponId) => grantWeaponDebug(id),
        clearArea: (area: EnemyArea) => {
          for (const e of enemies) {
            if (e.area === area && e.state !== "dead") {
              const died = e.applyDamage(999999);
              if (died) killCount++;
            }
          }
        },
        doorState: (doorId: string) => doorSystem.get(doorId)?.status,
        forceComplete: () => {
          const completionSeconds = runStartSeconds !== null ? elapsedSeconds - runStartSeconds : 0;
          winScreen.show(completionSeconds, killCount);
          gameState.setState("complete");
        },
        musicState: () => music.getState(),
        maxFrameMs: () => loop?.getMaxFrameMs() ?? 0,
        resetMaxFrameMs: () => loop?.resetMaxFrameMs(),
      },
    };

    // 5. 啟動主迴圈（不等待點擊／pointer lock）
    loop = new GameLoop((dt) => {
      try {
        elapsedSeconds += dt;
        const mouseDelta = input.consumeMouseDelta(); // 每幀排空，避免暫停期間堆積（見下方閘門）
        const weaponSwitchRequest = input.consumeWeaponSwitch();

        // 狀態閘：非 playing（menu／paused／complete）時完全跳過模擬（玩家移動、武器、敵人、
        // 戰鬥、特效、門、撿取），只保留渲染（世界維持在最後一個模擬幀）。debug hooks 定義在
        // 此閘門之外（見上方 window.__p96），任何狀態都能直接生效。
        if (gameState.state === "playing") {
          player.update(dt, input.state, mouseDelta, activeColliders());

          const simDt = debugFreezeFx ? 0 : dt;

          inventory.update(simDt);

          if (weaponSwitchRequest === 1 && inventory.switchTo("pistol")) {
            weaponSwitchFx.trigger();
            playSwitch();
          } else if (weaponSwitchRequest === 2 && inventory.switchTo("shotgun")) {
            weaponSwitchFx.trigger();
            playSwitch();
          }

          if (input.firing) performFire();

          recoil.update(simDt);
          muzzleFlash.update(simDt);
          tracer.update(simDt);
          spark.update(simDt);
          weaponSwitchFx.update(simDt);
          shotgunTracerElapsed += simDt;
          shotgunSparkElapsed += simDt;
          hud.updateToast(simDt);

          const playerFeet = player.position;
          const playerEyeForEnemies = player.getEyePosition();
          const colliders = activeColliders();
          for (const enemy of enemies) {
            const attackEvent = enemy.update(simDt, playerFeet, playerEyeForEnemies, colliders);
            if (attackEvent) applyDamageToPlayer(attackEvent.damage);
          }
          enemies = enemies.filter((e) => !e.removable);

          // M2 第三階段：任一存活敵人處於 chase／attack／retreat／hurt 即視為戰鬥態
          // （本次派工規格），驅動雙態音樂系統的 3 秒滯後狀態機（見 audio/music.ts）。
          const anyEnemyAggro = enemies.some(
            (e) => e.state === "chase" || e.state === "attack" || e.state === "retreat" || e.state === "hurt",
          );
          music.update(simDt, anyEnemyAggro);

          const respawnTriggered = combat.update(simDt);
          if (respawnTriggered) resetLevelState({ resetCombat: false, playSound: true });

          // 撿取：走近 0.8m 自動拾取。
          for (const pr of pickupRuntimes) {
            if (pr.collected) continue;
            if (distanceXZ(playerFeet, pr.def.pos) <= PICKUP_RADIUS) collectPickup(pr);
          }

          // 門：條件（持有武器／區域敵人全滅）加玩家靠近距離自動觸發開啟。
          const areaClearB = !enemies.some((e) => e.area === "B" && e.state !== "dead");
          const areaClearC = ambushTriggered && !enemies.some((e) => e.area === "C" && e.state !== "dead");
          const doorCtx: DoorRuntimeContext = { hasWeapon: inventory.ownsAny(), areaClearB, areaClearC };
          doorSystem.update(simDt, doorCtx, playerFeet);

          const lockedHint = doorSystem.nearestLockedHint(doorCtx, playerFeet);
          hud.setHint(lockedHint ?? (inventory.ownsAny() ? null : "尚未持有武器，前往台座拾取脈衝手槍"));

          // 終點觸發區：走入即通關（僅在 playing 時檢查，避免 complete 後重複觸發）。
          if (pointInAabb({ x: playerFeet.x, y: playerFeet.y + 0.9, z: playerFeet.z }, level.endTrigger)) {
            triggerLevelComplete();
          }
        }

        const viewMatrix = player.getViewMatrix();
        const playerEye = player.getEyePosition();

        // 世界：地板／牆面／天花板 → 敵人 → 門與撿取物 props → 世界空間 FX → viewmodel
        renderer.render(viewMatrix, playerEye, elapsedSeconds);
        const enemyInstances: EnemyInstance[] = enemies.map((e) => ({
          model: translationRotationYMat4(e.position, e.yaw),
          dissolve: e.dissolveProgress,
          hitFlash: e.hitFlashIntensity,
        }));
        renderer.renderEnemies(viewMatrix, enemyInstances);

        // 門與撿取物：共用頂點色 prop pipeline（見 gfx/renderer.ts renderProps）。
        const propInstances: { key: string; model: Mat4 }[] = [];
        for (const doorRuntime of doorSystem.list()) {
          // 門底 y 恆為 0（DoorDef.pos 為門底中心座標），開啟時沿 +Y 滑動自身高度，完全讓出開口。
          const slideOffset = doorRuntime.progress * DOOR_OPEN_SLIDE_DISTANCE;
          const doorWorldPos: Vec3 = { x: doorRuntime.def.pos.x, y: slideOffset, z: doorRuntime.def.pos.z };
          propInstances.push({
            key: "door",
            model: multiply(translationMat4(doorWorldPos), rotationYMat4(doorRuntime.def.yaw)),
          });
        }
        for (const pr of pickupRuntimes) {
          if (pr.collected) continue;
          const bob = Math.sin(elapsedSeconds * PICKUP_BOB_SPEED + pr.def.pos.x) * PICKUP_BOB_AMPLITUDE;
          const yaw = elapsedSeconds * PICKUP_ROTATE_SPEED;
          if (pr.def.kind === "weapon-pistol" || pr.def.kind === "weapon-shotgun") {
            const key = pr.def.kind === "weapon-pistol" ? "pickup-pistol" : "pickup-shotgun";
            const pos: Vec3 = { x: pr.def.pos.x, y: WEAPON_PICKUP_HEIGHT + bob, z: pr.def.pos.z };
            propInstances.push({ key, model: trsMat4(pos, yaw, WEAPON_PICKUP_SCALE) });
          } else {
            const key = pr.def.kind === "medkit" ? "pickup-medkit" : "pickup-ammo";
            const pos: Vec3 = { x: pr.def.pos.x, y: PROP_PICKUP_HEIGHT + bob, z: pr.def.pos.z };
            propInstances.push({ key, model: trsMat4(pos, yaw, 1) });
          }
        }
        renderer.renderProps(viewMatrix, propInstances);

        const tracerData = tracer.current;
        if (tracerData) {
          renderer.renderFx(viewMatrix, identity(), buildTracerVertices(tracerData.origin, tracerData.hitPoint), "LINES");
        }
        const sparkData = spark.current;
        if (sparkData && sparkJitterOffsets.length > 0) {
          const alpha = 1 - spark.progress;
          renderer.renderFx(
            viewMatrix,
            identity(),
            buildSparkVertices(sparkData.point, sparkJitterOffsets, sparkData.kind, alpha),
            "POINTS",
          );
        }
        if (shotgunTracerElapsed < SHOTGUN_TRACER_LIFETIME && shotgunTracerData.length > 0) {
          renderer.renderFx(viewMatrix, identity(), buildMultiTracerVertices(shotgunTracerData), "LINES");
        }
        if (shotgunSparkElapsed < SHOTGUN_SPARK_LIFETIME && shotgunSparkData.length > 0) {
          const alpha = 1 - shotgunSparkElapsed / SHOTGUN_SPARK_LIFETIME;
          renderer.renderFx(viewMatrix, identity(), buildMultiSparkVertices(shotgunSparkData, alpha), "POINTS");
        }

        // viewmodel（清深度蓋在世界之上，錨定畫面右下角）＋槍口閃光；無裝備武器時不繪製
        // （撿取前赤手空拳，本次派工規格），特效仍照常凍結／更新以維持狀態一致。
        const recoilAmount = recoil.amount;
        const switchDip = weaponSwitchFx.dipAmount;
        const viewmodelOffset: Vec3 = {
          x: VIEWMODEL_BASE_OFFSET.x,
          y: VIEWMODEL_BASE_OFFSET.y + RECOIL_KICK_Y * recoilAmount - WEAPON_SWITCH_DIP_Y * switchDip,
          z: VIEWMODEL_BASE_OFFSET.z + RECOIL_KICK_Z * recoilAmount,
        };
        const currentWeapon = inventory.current;
        if (currentWeapon) {
          renderer.renderViewmodel(translationMat4(viewmodelOffset), currentWeapon);

          if (muzzleFlash.active) {
            const muzzleLocal = currentWeapon === "shotgun" ? shotgunMesh.muzzleLocal : pistolMesh.muzzleLocal;
            const muzzleViewPos: Vec3 = {
              x: viewmodelOffset.x + muzzleLocal.x,
              y: viewmodelOffset.y + muzzleLocal.y,
              z: viewmodelOffset.z + muzzleLocal.z - 0.02,
            };
            renderer.renderFx(identity(), identity(), buildQuadVertices(muzzleViewPos, MUZZLE_FLASH_HALF_SIZE, MUZZLE_FLASH_COLOR), "TRIANGLES");
          }
        }

        hud.updateHp(combat.playerHp, PLAYER_MAX_HP);
        hud.updateWeaponName(currentWeapon);
        hud.updateAmmo(inventory.ammo(), currentWeapon === "pistol" ? PULSE_PISTOL_MAGAZINE : currentWeapon === "shotgun" ? SCATTER_MAGAZINE : 0);
        hud.setHurtFlash(combat.hurtFlashIntensity);
        overlay.setCrosshairHit(inventory.pistol.hitMarkerActive || inventory.shotgun.hitMarkerActive);
        if (combat.isDead) {
          hud.showDeathScreen(combat.respawnSecondsRemaining);
        } else {
          hud.hideDeathScreen();
        }

        if (window.__p96) window.__p96.frames++;
      } catch (err) {
        console.error(err);
        loop?.stop();
        overlay.showError(describeError(err));
      }
    });
    loop.start();
  } catch (err) {
    console.error(err);
    overlay.showError(describeError(err));
  }
}

boot();
