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
import { generateSpitterMesh } from "./procgen/mesh/spitter.ts";
import { generateWardenMesh } from "./procgen/mesh/warden.ts";
import { generatePistolMesh } from "./procgen/mesh/pistol.ts";
import { generateShotgunMesh } from "./procgen/mesh/shotgun.ts";
import { generatePlasmaRifleMesh } from "./procgen/mesh/plasma-rifle.ts";
import { generateDoorMesh } from "./procgen/mesh/door.ts";
import { generateAmmoBoxMesh, generateMedkitBoxMesh } from "./procgen/mesh/pickup-props.ts";
import { generateConsoleMesh } from "./procgen/mesh/console.ts";
import { Renderer } from "./gfx/renderer.ts";
import type { EnemyInstance } from "./gfx/renderer.ts";
import { InputManager } from "./core/input.ts";
import { GameLoop } from "./core/loop.ts";
import { PlayerController, PITCH_LIMIT, PLAYER_HALF } from "./game/player.ts";
import { resolveAxisMove } from "./game/collision.ts";
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
import { Spitter, SPITTER_PROJECTILE_SPEED } from "./game/spitter.ts";
import type { SpitterState } from "./game/spitter.ts";
import { Warden } from "./game/warden.ts";
import type { WardenState } from "./game/warden.ts";
import type { FireResult, Shootable, WeaponId } from "./game/weapons.ts";
import { PULSE_PISTOL_MAGAZINE } from "./game/weapons.ts";
import type { ScatterFireResult } from "./game/shotgun.ts";
import { SCATTER_MAGAZINE } from "./game/shotgun.ts";
import { PLASMA_RIFLE_MAGAZINE } from "./game/plasma.ts";
import type { PlasmaFireResult } from "./game/plasma.ts";
import { WeaponInventory } from "./game/inventory.ts";
import { Combat, PLAYER_MAX_HP } from "./game/combat.ts";
import { Recoil, MuzzleFlashEffect, TracerEffect, SparkEffect, WeaponSwitchEffect } from "./game/effects.ts";
import { DoorSystem } from "./game/doors.ts";
import type { DoorRuntimeContext } from "./game/doors.ts";
import { ProjectileSystem } from "./game/projectiles.ts";
import type { ProjectileFaction, ProjectileInstance, ProjectileTarget } from "./game/projectiles.ts";
import { ConsoleSystem } from "./game/console.ts";
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
  playSpitterFire,
  playSpitterWindup,
  playConsoleActivate,
  playHit,
  playEnemyDie,
  playWardenChargeWindup,
  playWardenChargeImpact,
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
const AMMO_PLASMA_PICKUP_AMOUNT = 36; // M3 第二階段新增：電漿步槍彈藥上限 180 的稀少補給
const MEDKIT_HEAL_AMOUNT = 25;

const PICKUP_BOB_AMPLITUDE = 0.06;
const PICKUP_BOB_SPEED = 1.6; // rad/s
const PICKUP_ROTATE_SPEED = 1.1; // rad/s
const WEAPON_PICKUP_SCALE = 2.4;
const WEAPON_PICKUP_HEIGHT = 1.0; // 地面上方懸浮高度
const PROP_PICKUP_HEIGHT = 0.75;

const SHOTGUN_TRACER_LIFETIME = 0.06;
const SHOTGUN_SPARK_LIFETIME = 0.15;

// M3：射擊體投射物視覺（渲染用現有 FX pipeline，見 buildProjectileVertices／renderFx）。
const SPITTER_PROJECTILE_RADIUS = 0.15; // m，命中判定容差半徑（game/projectiles.ts expandAabb 用）
const SPITTER_PROJECTILE_COLOR: [number, number, number] = [1.0, 0.42, 0.15]; // 警示橘（enemy 陣營）
const CONSOLE_PROMPT_TEXT = "按 E 啟動控制台";

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

/** 投射物（射擊體發射的能量彈）渲染頂點：每發一個點，依陣營色渲染（M3 新增，沿用 FX pipeline）。 */
// 投射物彈體視覺：雙層相機面 quad（外層暈光加內核亮心）。
// 2026-08-05 修正：原實作用 gl.POINTS 固定 14px，遠距離在暗場景形同不可見（Lin 實玩回饋
// 「沒有看到橘色能量彈」）。改為有世界尺寸的面片，距離遠近皆有實體感。
const PROJECTILE_GLOW_HALF = 0.12; // m，外層暈光（2026-08-05 由 0.26 縮小，Lin 實玩回饋「能量彈太大」）
const PROJECTILE_CORE_HALF = 0.05; // m，內核亮心（同上，由 0.11 縮小）
const PROJECTILE_GROW_SECONDS = 0.08; // 生成後漸長至全尺寸的秒數（見 buildProjectileVertices 註解）

function buildProjectileVertices(instances: ProjectileInstance[], camYaw: number): Float32Array {
  // billboard：面片沿相機 right（依 yaw 推導）與世界 up 展開，任何視角都正對玩家。
  // 固定世界 x/y 平面的版本在玩家沿 X 軸看時會被側看成零厚度縫（本修正的根因）。
  const rightX = Math.cos(camYaw);
  const rightZ = -Math.sin(camYaw);
  const offsets: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ];
  const verts: number[] = [];
  const pushQuad = (p: ProjectileInstance, half: number, r: number, g: number, b: number, a: number): void => {
    for (const [dx, dy] of offsets) {
      verts.push(p.pos.x + dx * half * rightX, p.pos.y + dy * half, p.pos.z + dx * half * rightZ, r, g, b, a);
    }
  };
  for (const p of instances) {
    const [r, g, b] = p.color;
    // 生成後漸長（2026-08-05，Lin 回饋「電漿擊發時暈光太大」）：電漿彈生成點在相機眼睛座標，
    // 第一幀貼臉的全尺寸暈光形同一團大閃光。以 age 從 25% 漸長至 100%（0.08 秒），彈體離開
    // 臉部後才到全尺寸；遠處生成的敵方彈體 0.08 秒內已飛離砲口，玩家視角無感。
    const growScale = clamp(p.age / PROJECTILE_GROW_SECONDS, 0.25, 1);
    pushQuad(p, PROJECTILE_GLOW_HALF * growScale, r, g, b, 0.35); // 外層暈光：原色、半透明
    // 內核亮心：往白提亮、不透明
    pushQuad(p, PROJECTILE_CORE_HALF * growScale, Math.min(1, r + 0.45), Math.min(1, g + 0.45), Math.min(1, b + 0.45), 1);
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
    const spitterMesh = generateSpitterMesh();
    const wardenMesh = generateWardenMesh();
    const pistolMesh = generatePistolMesh();
    const shotgunMesh = generateShotgunMesh();
    const plasmaRifleMesh = generatePlasmaRifleMesh();
    const doorMesh = generateDoorMesh();
    const ammoBoxMesh = generateAmmoBoxMesh();
    const medkitBoxMesh = generateMedkitBoxMesh();
    const consoleIdleMesh = generateConsoleMesh(false);
    const consoleActiveMesh = generateConsoleMesh(true);
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
    renderer.uploadEnemyGeometry("crawler", crawlerMesh.vertices, crawlerMesh.indices);
    renderer.uploadEnemyGeometry("spitter", spitterMesh.vertices, spitterMesh.indices);
    renderer.uploadEnemyGeometry("warden", wardenMesh.vertices, wardenMesh.indices);
    renderer.uploadViewmodelGeometry(pistolMesh.vertices, pistolMesh.indices);
    renderer.uploadShotgunViewmodelGeometry(shotgunMesh.vertices, shotgunMesh.indices);
    renderer.uploadPlasmaViewmodelGeometry(plasmaRifleMesh.vertices, plasmaRifleMesh.indices);
    renderer.uploadPropGeometry("door", doorMesh.vertices, doorMesh.indices);
    renderer.uploadPropGeometry("pickup-pistol", pistolMesh.vertices, pistolMesh.indices);
    renderer.uploadPropGeometry("pickup-shotgun", shotgunMesh.vertices, shotgunMesh.indices);
    renderer.uploadPropGeometry("pickup-plasma", plasmaRifleMesh.vertices, plasmaRifleMesh.indices);
    renderer.uploadPropGeometry("pickup-ammo", ammoBoxMesh.vertices, ammoBoxMesh.indices);
    renderer.uploadPropGeometry("pickup-medkit", medkitBoxMesh.vertices, medkitBoxMesh.indices);
    renderer.uploadPropGeometry("console-idle", consoleIdleMesh.vertices, consoleIdleMesh.indices);
    renderer.uploadPropGeometry("console-active", consoleActiveMesh.vertices, consoleActiveMesh.indices);

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
    // M3 第二階段：區域 E 的巡行體與區域 B 同慣例，出生即 idle（一般偵測，非伏擊 direct aggro）。
    let enemies: Crawler[] = [...spawnAreaEnemies("B", "idle"), ...spawnAreaEnemies("E", "idle")];
    let ambushTriggered = false;

    // M3：射擊體（區域 D、E），獨立於 Crawler 的 id 命名空間與陣列（不同敵人類別，見 game/spitter.ts）。
    let nextSpitterId = 0;
    function spawnSpitters(): Spitter[] {
      return level.spitterSpawns.map((s) => new Spitter(nextSpitterId++, s.pos, "idle", s.area));
    }
    let spitters: Spitter[] = spawnSpitters();
    /** 上一幀各射擊體的狀態（依 id 索引），供偵測「本幀剛進入 windup」以觸發一次性蓄力音效
     *  （同 DoorSystem.onOpenStart 的「開始當幀觸發一次」精神，但射擊體無單一系統類別可掛
     *  回呼，改用本地 Map 追蹤前一幀狀態）。 */
    const spitterPrevState = new Map<number, SpitterState>();

    // M3 第二階段：守衛體（區域 E），獨立於 Crawler／Spitter 的 id 命名空間與陣列
    // （不同敵人類別，見 game/warden.ts）。
    let nextWardenId = 0;
    function spawnWardens(): Warden[] {
      return level.wardenSpawns.map((w) => new Warden(nextWardenId++, w.pos, "idle", w.area));
    }
    let wardens: Warden[] = spawnWardens();
    /** 上一幀各守衛體的狀態（同 spitterPrevState 慣例），供偵測「本幀剛進入 windup」
     *  觸發一次性衝撞蓄力音效。 */
    const wardenPrevState = new Map<number, WardenState>();

    const projectiles = new ProjectileSystem();
    const consoleSystem = new ConsoleSystem(level.consoleDef);

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
      music.resetToExplore(); // combat 單向化後（2026-08-05），新局不得殘留上一局的戰鬥層
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

    /** 對玩家造成傷害的共用路徑：命中即播放受傷音效（供敵人近戰、投射物與 debug hook 共用）。 */
    function applyDamageToPlayer(amount: number): boolean {
      const applied = combat.damagePlayer(amount);
      if (applied) playPlayerHurt();
      return applied;
    }

    /** 守衛體衝撞命中的短暫擊退：對玩家水平位置套用一次性位移，沿用 resolveAxisMove 逐軸碰撞
     *  解算（同 player.ts 移動慣例），避免擊退把玩家推穿牆面（M3 第二階段新增）。 */
    function applyKnockbackToPlayer(knockback: Vec3): void {
      const half = PLAYER_HALF;
      const colliders = activeColliders();
      let center: Vec3 = { x: player.position.x, y: player.position.y + half.y, z: player.position.z };
      const rx = resolveAxisMove(center, half, "x", knockback.x, colliders);
      center = { ...center, x: center.x + rx.delta };
      const rz = resolveAxisMove(center, half, "z", knockback.z, colliders);
      center = { ...center, z: center.z + rz.delta };
      player.position = { x: center.x, y: player.position.y, z: center.z };
    }

    /** 玩家目前世界 AABB（供 game/projectiles.ts 的 enemy 陣營投射物命中判定使用）。 */
    function getPlayerAabb(): Aabb {
      const half = PLAYER_HALF;
      const center: Vec3 = { x: player.position.x, y: player.position.y + half.y, z: player.position.z };
      return {
        min: { x: center.x - half.x, y: center.y - half.y, z: center.z - half.z },
        max: { x: center.x + half.x, y: center.y + half.y, z: center.z + half.z },
      };
    }

    /** 投射物系統的目標查詢（M3 新增，第二階段擴充涵蓋守衛體）：enemy 陣營回傳玩家
     *  （單一元素）；player 陣營（電漿步槍）回傳存活的敵人（Crawler／Spitter／Warden 皆可，
     *  hitDirection 由 ProjectileSystem.update() 傳入 p.dir，供 Warden 方向性減傷判定使用）。 */
    function projectileTargetQuery(faction: ProjectileFaction): ProjectileTarget[] {
      if (faction === "enemy") {
        return [
          {
            getAabb: getPlayerAabb,
            applyDamage: (amount: number) => applyDamageToPlayer(amount),
          },
        ];
      }
      return [...enemies, ...spitters, ...wardens].filter((e) => e.state !== "dead");
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
        case "weapon-plasma":
          inventory.give("plasma");
          hud.showToast("拾取電漿步槍");
          break;
        case "ammo-pistol":
          inventory.addAmmo("pistol", AMMO_PISTOL_PICKUP_AMOUNT);
          hud.showToast(`拾取彈藥 +${AMMO_PISTOL_PICKUP_AMOUNT}`);
          break;
        case "ammo-shotgun":
          inventory.addAmmo("shotgun", AMMO_SHOTGUN_PICKUP_AMOUNT);
          hud.showToast(`拾取彈藥 +${AMMO_SHOTGUN_PICKUP_AMOUNT}`);
          break;
        case "ammo-plasma":
          inventory.addAmmo("plasma", AMMO_PLASMA_PICKUP_AMOUNT);
          hud.showToast(`拾取彈藥 +${AMMO_PLASMA_PICKUP_AMOUNT}`);
          break;
        case "medkit": {
          const healed = combat.heal(MEDKIT_HEAL_AMOUNT);
          hud.showToast(`生命 +${healed}`);
          break;
        }
      }
    }

    function grantWeaponDebug(id: WeaponId): void {
      const kind: PickupKind = id === "pistol" ? "weapon-pistol" : id === "shotgun" ? "weapon-shotgun" : "weapon-plasma";
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

      if (current === "plasma") {
        // 電漿步槍為投射物武器，不走 raycastScene（命中判定延後至 ProjectileSystem.update()），
        // 不需 colliders／targets（見 game/plasma.ts 檔頭註解）。
        const result = inventory.plasma.tryFire(eye, forward);
        handlePlasmaFireResult(result);
        return result.fired;
      }

      const colliders = activeColliders();
      // M3：可命中目標泛化為 Crawler／Spitter／Warden 混合陣列（見 game/weapons.ts Shootable 介面）。
      const targets: Shootable[] = [...enemies, ...spitters, ...wardens];

      if (current === "pistol") {
        const result = inventory.pistol.tryFire(eye, forward, colliders, targets);
        handleFireResult(result);
        return result.fired;
      }
      const result = inventory.shotgun.tryFire(eye, forward, colliders, targets);
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

    /** 電漿步槍開火視覺回饋：後座／槍口閃光沿用 M1 單槽狀態機（同其餘武器）；命中不在開火
     *  當下決定（投射物飛行中，數幀後才可能命中，見 game/plasma.ts 檔頭註解），故不在此處理
     *  tracer／spark／killCount——那些改在下方主迴圈的 projectileHits 迴圈統一處理
     *  （player 陣營命中事件，同時涵蓋電漿步槍與日後能量砲等投射物武器）。 */
    function handlePlasmaFireResult(result: PlasmaFireResult): void {
      if (!result.fired || !result.spawnEvent) return;
      projectiles.spawn(result.spawnEvent);
      recoil.trigger();
      muzzleFlash.trigger();
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
      enemies = [...spawnAreaEnemies("B", "idle"), ...spawnAreaEnemies("E", "idle")];
      ambushTriggered = false;
      nextSpitterId = 0;
      spitters = spawnSpitters();
      spitterPrevState.clear();
      nextWardenId = 0;
      wardens = spawnWardens();
      wardenPrevState.clear();
      projectiles.reset();
      consoleSystem.reset();
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
      /** 存活射擊體數（M3 新增，同 enemiesAlive 慣例）。 */
      spittersAlive: () => spitters.filter((s) => s.state !== "dead").length,
      /** 存活守衛體數（M3 第二階段新增，同 enemiesAlive 慣例）。 */
      wardensAlive: () => wardens.filter((w) => w.state !== "dead").length,
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
            .map((e) => ({ x: e.position.x, y: e.position.y, z: e.position.z, yaw: e.yaw, state: e.state, area: e.area })),
        /** 存活守衛體的位置／面向／狀態／HP（M3 第二階段新增，供驗收讀取取景，並供「正面打
         *  守衛體傷害減半」的 Playwright 測試以 damage 前後 HP 差比較驗證方向性減傷）。 */
        wardenTransforms: () =>
          wardens
            .filter((w) => w.state !== "dead")
            .map((w) => ({ x: w.position.x, y: w.position.y, z: w.position.z, yaw: w.yaw, state: w.state, hp: w.hp })),
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
          for (const s of spitters) {
            if (s.area === area && s.state !== "dead") {
              const died = s.applyDamage(999999);
              if (died) killCount++;
            }
          }
          for (const w of wardens) {
            if (w.area === area && w.state !== "dead") {
              const died = w.applyDamage(999999);
              if (died) killCount++;
            }
          }
        },
        doorState: (doorId: string) => doorSystem.get(doorId)?.status,
        /** 強制啟動區域 D 控制台，略過走近距離（debug 後門，同 grantWeapon／clearArea 慣例，M3 新增）。 */
        activateConsole: () => {
          const activated = consoleSystem.forceActivate();
          if (activated) playConsoleActivate();
        },
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
        const interactRequest = input.consumeInteract(); // E 鍵，同上：每幀排空，只在 playing 內生效

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
          } else if (weaponSwitchRequest === 3 && inventory.switchTo("plasma")) {
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

          // M3：射擊體更新（reposition／windup／shoot），發射事件交給 ProjectileSystem 產生實體
          // 投射物；windup 一次性音效靠 spitterPrevState 偵測「本幀剛進入 windup」觸發一次。
          for (const s of spitters) {
            const wasWindup = spitterPrevState.get(s.id) === "windup";
            const shootEvent = s.update(simDt, playerFeet, playerEyeForEnemies, colliders);
            if (!wasWindup && s.state === "windup") playSpitterWindup();
            spitterPrevState.set(s.id, s.state);
            if (shootEvent) {
              projectiles.spawn({
                pos: shootEvent.origin,
                dir: shootEvent.dir,
                speed: SPITTER_PROJECTILE_SPEED,
                damage: shootEvent.damage,
                radius: SPITTER_PROJECTILE_RADIUS,
                faction: "enemy",
                color: SPITTER_PROJECTILE_COLOR,
              });
              playSpitterFire();
            }
          }
          spitters = spitters.filter((s) => !s.removable);

          // M3 第二階段：守衛體更新（advance／windup／charge／attack），衝撞命中回傳擊退向量；
          // windup 一次性音效靠 wardenPrevState 偵測「本幀剛進入 windup」觸發一次（同射擊體慣例）。
          for (const w of wardens) {
            const wasWindup = wardenPrevState.get(w.id) === "windup";
            const attackEvent = w.update(simDt, playerFeet, playerEyeForEnemies, colliders);
            if (!wasWindup && w.state === "windup") playWardenChargeWindup();
            wardenPrevState.set(w.id, w.state);
            if (attackEvent) {
              applyDamageToPlayer(attackEvent.damage);
              if (attackEvent.knockback) {
                applyKnockbackToPlayer(attackEvent.knockback);
                playWardenChargeImpact();
              }
            }
          }
          wardens = wardens.filter((w) => !w.removable);

          const projectileHits = projectiles.update(simDt, colliders, projectileTargetQuery);
          for (const hit of projectileHits) {
            // player 陣營（電漿步槍等投射物武器）命中敵人：觸發命中回饋（沿用 hitscan 武器的
            // hitMarker／音效慣例，只是時機延後到命中當下而非開火當下，見 game/plasma.ts）；
            // enemy 陣營命中玩家的傷害與受傷音效已在 applyDamageToPlayer（經 projectileTargetQuery
            // 的 adapter）處理過。
            if (hit.faction === "player") {
              inventory.plasma.triggerHitMarker();
              if (hit.died) {
                killCount++;
                playEnemyDie();
              } else {
                playHit();
              }
            }
          }

          // M3：控制台互動（E 鍵邊緣觸發，只在提示半徑內生效）。
          if (interactRequest) {
            const activated = consoleSystem.tryActivate(playerFeet);
            if (activated) playConsoleActivate();
          }

          // M2 第三階段：任一存活敵人處於 chase／attack／retreat／hurt 即視為戰鬥態，
          // 驅動雙態音樂系統（見 audio/music.ts；2026-08-05 起 combat 單向持續，
          // 敵人清空不退回 explore，僅重新開始或回選單重進才重置）。
          // M3：射擊體的 reposition／windup／shoot／hurt 同樣視為戰鬥態。
          // M3 第二階段：守衛體的 advance／windup／charge／attack／hurt 同樣視為戰鬥態。
          const anyEnemyAggro =
            enemies.some((e) => e.state === "chase" || e.state === "attack" || e.state === "retreat" || e.state === "hurt") ||
            spitters.some((s) => s.state === "reposition" || s.state === "windup" || s.state === "shoot" || s.state === "hurt") ||
            wardens.some(
              (w) => w.state === "advance" || w.state === "windup" || w.state === "charge" || w.state === "attack" || w.state === "hurt",
            );
          music.update(simDt, anyEnemyAggro);

          const respawnTriggered = combat.update(simDt);
          if (respawnTriggered) resetLevelState({ resetCombat: false, playSound: true });

          // 撿取：走近 0.8m 自動拾取。
          for (const pr of pickupRuntimes) {
            if (pr.collected) continue;
            if (distanceXZ(playerFeet, pr.def.pos) <= PICKUP_RADIUS) collectPickup(pr);
          }

          // 門：條件（持有武器／區域敵人全滅／控制台啟動）加玩家靠近距離自動觸發開啟。
          const areaClearB = !enemies.some((e) => e.area === "B" && e.state !== "dead");
          const areaClearC = ambushTriggered && !enemies.some((e) => e.area === "C" && e.state !== "dead");
          // M3 第二階段：區域 E 全滅＝巡行體、射擊體、守衛體三種敵人類別皆需清空（混編）。
          const areaClearE =
            !enemies.some((e) => e.area === "E" && e.state !== "dead") &&
            !spitters.some((s) => s.area === "E" && s.state !== "dead") &&
            !wardens.some((w) => w.area === "E" && w.state !== "dead");
          const doorCtx: DoorRuntimeContext = {
            hasWeapon: inventory.ownsAny(),
            areaClearB,
            areaClearC,
            consoleActivated: consoleSystem.isActivated,
            areaClearE,
          };
          doorSystem.update(simDt, doorCtx, playerFeet);

          const lockedHint = doorSystem.nearestLockedHint(doorCtx, playerFeet);
          const consolePrompt = consoleSystem.isPromptVisible(playerFeet) ? CONSOLE_PROMPT_TEXT : null;
          hud.setHint(lockedHint ?? consolePrompt ?? (inventory.ownsAny() ? null : "尚未持有武器，前往台座拾取脈衝手槍"));

          // 終點觸發區：走入即通關（僅在 playing 時檢查，避免 complete 後重複觸發）。
          if (pointInAabb({ x: playerFeet.x, y: playerFeet.y + 0.9, z: playerFeet.z }, level.endTrigger)) {
            triggerLevelComplete();
          }
        }

        const viewMatrix = player.getViewMatrix();
        const playerEye = player.getEyePosition();

        // 世界：地板／牆面／天花板 → 敵人 → 門與撿取物 props → 世界空間 FX → viewmodel
        renderer.render(viewMatrix, playerEye, elapsedSeconds);
        const enemyInstances: EnemyInstance[] = [
          ...enemies.map((e) => ({
            mesh: "crawler",
            model: translationRotationYMat4(e.position, e.yaw),
            dissolve: e.dissolveProgress,
            hitFlash: e.hitFlashIntensity,
          })),
          ...spitters.map((s) => ({
            mesh: "spitter",
            model: translationRotationYMat4(s.position, s.yaw),
            dissolve: s.dissolveProgress,
            hitFlash: s.hitFlashIntensity,
            telegraph: s.telegraphIntensity,
          })),
          ...wardens.map((w) => ({
            mesh: "warden",
            model: translationRotationYMat4(w.position, w.yaw),
            dissolve: w.dissolveProgress,
            hitFlash: w.hitFlashIntensity,
            telegraph: w.telegraphIntensity,
          })),
        ];
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
          if (pr.def.kind === "weapon-pistol" || pr.def.kind === "weapon-shotgun" || pr.def.kind === "weapon-plasma") {
            const key = pr.def.kind === "weapon-pistol" ? "pickup-pistol" : pr.def.kind === "weapon-shotgun" ? "pickup-shotgun" : "pickup-plasma";
            const pos: Vec3 = { x: pr.def.pos.x, y: WEAPON_PICKUP_HEIGHT + bob, z: pr.def.pos.z };
            propInstances.push({ key, model: trsMat4(pos, yaw, WEAPON_PICKUP_SCALE) });
          } else {
            const key = pr.def.kind === "medkit" ? "pickup-medkit" : "pickup-ammo";
            const pos: Vec3 = { x: pr.def.pos.x, y: PROP_PICKUP_HEIGHT + bob, z: pr.def.pos.z };
            propInstances.push({ key, model: trsMat4(pos, yaw, 1) });
          }
        }
        // 控制台：M3 新增，依 ConsoleSystem.isActivated 切換 console-idle／console-active 網格
        // （面板變色，見 procgen/mesh/console.ts）。
        propInstances.push({
          key: consoleSystem.isActivated ? "console-active" : "console-idle",
          model: translationMat4(level.consoleDef.pos),
        });

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

        // M3：射擊體投射物（雙層發光 billboard 面片，沿用 FX pipeline，見 buildProjectileVertices）。
        const projectileInstances = projectiles.instances;
        if (projectileInstances.length > 0) {
          renderer.renderFx(viewMatrix, identity(), buildProjectileVertices(projectileInstances, player.yaw), "TRIANGLES");
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
            const muzzleLocal =
              currentWeapon === "shotgun"
                ? shotgunMesh.muzzleLocal
                : currentWeapon === "plasma"
                  ? plasmaRifleMesh.muzzleLocal
                  : pistolMesh.muzzleLocal;
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
        hud.updateAmmo(
          inventory.ammo(),
          currentWeapon === "pistol"
            ? PULSE_PISTOL_MAGAZINE
            : currentWeapon === "shotgun"
              ? SCATTER_MAGAZINE
              : currentWeapon === "plasma"
                ? PLASMA_RIFLE_MAGAZINE
                : 0,
        );
        hud.setHurtFlash(combat.hurtFlashIntensity);
        overlay.setCrosshairHit(inventory.pistol.hitMarkerActive || inventory.shotgun.hitMarkerActive || inventory.plasma.hitMarkerActive);
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
