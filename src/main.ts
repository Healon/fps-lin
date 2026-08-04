// boot 流程：生成關卡（含敵人配置）→ 生成材質、敵人模型、武器 viewmodel → 初始化 GL 與 buffer →
// 設 window.__p96 → 啟動迴圈。
// 渲染迴圈不等點擊就開跑（點擊只負責 pointer lock 與音訊手勢），讓自動化測試不需手勢即可驗 frames。
// 任何 boot 或執行期錯誤一律顯示在 overlay 上，禁止靜默失敗。
//
// 2026-08-04：加入第一人稱武器 viewmodel 與射擊視覺回饋（後座／槍口閃光／彈道 tracer／命中
// 火花），回應 Lin 實玩回饋「開槍看不見、命中看不見」（根因：先前無 viewmodel、無任何射擊
// 視覺特效）。效果生命週期見 game/effects.ts；渲染見 gfx/renderer.ts 的 renderViewmodel／renderFx。
//
// 2026-08-04（M2）：加入 game/state.ts 的三態遊戲狀態機（menu／playing／paused），收掉 HANDOFF
// 待辦第 3 條技術債「開始畫面下遊戲邏輯已在跑」。每幀更新一律以 `gameState.state === "playing"`
// 為唯一閘門：非 playing 時完全跳過玩家移動／武器／敵人／戰鬥／特效的模擬（渲染仍持續執行，
// 世界維持在最後一個模擬幀，即「持續渲染但邏輯不更新」——見 game/state.ts 與本檔 syncUiForState
// 註解）。__p96 的 fire()／damagePlayer() 等 debug hooks 刻意留在閘門之外，任何狀態都直接生效
// （測試用後門，繞過狀態閘）；真實輸入路徑（input.firing、真實滑鼠／鍵盤）則一律被閘門擋住。
// 另加入 core/settings.ts 的設定系統（靈敏度／音量／FOV，localStorage 持久化）與 ui/menu.ts 的
// 暫停選單／設定面板，經由正式 API（player.setSensitivity／setMasterVolume／renderer.setFov）
// 套用，不直接改模組內部常數。

import { generateTestRoom } from "./procgen/level/room.ts";
import { TEXTURE_SIZE } from "./procgen/texture/noise.ts";
import { generateFloorFlagstoneTexture } from "./procgen/texture/flagstone.ts";
import { generateCastleWallTexture } from "./procgen/texture/castle.ts";
import { generateCrawlerMesh } from "./procgen/mesh/crawler.ts";
import { generatePistolMesh } from "./procgen/mesh/pistol.ts";
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
  identity,
  normalizeVec3,
  subVec3,
  type Vec3,
} from "./core/math.ts";
import { Crawler } from "./game/enemy.ts";
import { PulsePistol } from "./game/weapons.ts";
import type { FireResult } from "./game/weapons.ts";
import { PULSE_PISTOL_MAGAZINE } from "./game/weapons.ts";
import { Combat, PLAYER_MAX_HP } from "./game/combat.ts";
import { Recoil, MuzzleFlashEffect, TracerEffect, SparkEffect } from "./game/effects.ts";
import { GameStateMachine } from "./game/state.ts";
import type { GameState } from "./game/state.ts";
import { SettingsStore, createBrowserStorage } from "./core/settings.ts";
import { Overlay } from "./ui/overlay.ts";
import { Hud } from "./ui/hud.ts";
import { PauseMenu, SettingsPanel } from "./ui/menu.ts";
import { resumeAudioOnGesture, playPlayerHurt, playRespawn, setMasterVolume } from "./audio/synth.ts";
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

const MUZZLE_FLASH_HALF_SIZE = 0.045;
const MUZZLE_FLASH_COLOR: [number, number, number, number] = [0.85, 0.98, 1.0, 0.9]; // 青白
const TRACER_COLOR: [number, number, number, number] = [0.35, 0.88, 1.0, 0.85]; // 能源青
// 警示橘偏白熾亮（比敵人自身的警示橘 #FF5A26 更亮更白，避免與敵人本體警示色混在一起分不出
// 是「敵人」還是「火花」；命中牆面則用暗一階琥珀，兩者需一眼可分）。
const SPARK_COLOR_ENEMY: [number, number, number] = [1.0, 0.62, 0.35];
const SPARK_COLOR_WALL: [number, number, number] = [0.55, 0.36, 0.15];
const SPARK_COUNT = 6;
const SPARK_JITTER = 0.08; // m

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

function buildSparkVertices(point: Vec3, offsets: Vec3[], kind: "enemy" | "wall", alpha: number): Float32Array {
  const [r, g, b] = kind === "enemy" ? SPARK_COLOR_ENEMY : SPARK_COLOR_WALL;
  const verts: number[] = [];
  for (const o of offsets) {
    verts.push(point.x + o.x, point.y + o.y, point.z + o.z, r, g, b, alpha);
  }
  return new Float32Array(verts);
}

function boot(): void {
  const overlay = new Overlay();
  const hud = new Hud();
  const pauseMenu = new PauseMenu();
  const settingsStore = new SettingsStore(createBrowserStorage());
  const settingsPanel = new SettingsPanel(settingsStore.get());
  const gameState = new GameStateMachine();
  let loop: GameLoop | null = null;

  /**
   * 依目前狀態同步顯示哪個 UI 面板：唯一的顯示邏輯來源，任何狀態轉移（正常操作或
   * __p96.debug.setState() 測試切態）一律經此函式生效，避免顯示邏輯散落各觸發點。
   * paused／menu 皆隱藏準星（避免與選單文字重疊）；playing 則收起所有選單並顯示準星。
   */
  function syncUiForState(state: GameState): void {
    if (state === "playing") {
      overlay.hide();
      pauseMenu.hide();
      settingsPanel.hide();
      overlay.showCrosshair();
    } else if (state === "paused") {
      pauseMenu.show();
      overlay.hideCrosshair();
    } else {
      overlay.show();
      overlay.hideCrosshair();
    }
  }
  gameState.onChange((next) => syncUiForState(next));
  syncUiForState(gameState.state); // 初始畫面＝menu：顯示主選單、隱藏準星

  try {
    const canvas = document.getElementById("glcanvas") as HTMLCanvasElement | null;
    if (!canvas) throw new Error("找不到 #glcanvas 元素。");

    // 1. CPU 生成關卡資料（純決定性：碰撞 AABB、敵人配置、levelHash）
    const room = generateTestRoom();

    // 2. 生成材質、敵人模型、武器 viewmodel（外觀，CPU 決定性但非玩法決定性鐵則要求範圍）
    const floorTexture = generateFloorFlagstoneTexture(TEXTURE_SIZE);
    const wallTexture = generateCastleWallTexture(TEXTURE_SIZE);
    const crawlerMesh = generateCrawlerMesh();
    const pistolMesh = generatePistolMesh();

    // 3. 初始化 WebGL2 與 buffer
    const renderer = new Renderer(canvas);
    renderer.setFov(settingsStore.get().fov); // 套用已儲存（或預設）的 FOV，正式 API（非改內部常數）
    renderer.uploadFloorGeometry(room.floorVertices, room.floorIndices);
    renderer.uploadFloorTexture(floorTexture.size, floorTexture.pixels);
    renderer.uploadWallGeometry(room.wallVertices, room.wallIndices);
    renderer.uploadWallTexture(wallTexture.size, wallTexture.pixels);
    renderer.uploadCeilingGeometry(room.ceilingVertices, room.ceilingIndices);
    renderer.uploadEnemyGeometry(crawlerMesh.vertices, crawlerMesh.indices);
    renderer.uploadViewmodelGeometry(pistolMesh.vertices, pistolMesh.indices);

    const spawnPosition: Vec3 = { x: 0, y: room.floorY, z: 7 };
    const player = new PlayerController(spawnPosition);
    player.setSensitivity(settingsStore.get().sensitivity); // 正式 API，同時作用於方向鍵轉速
    const weapon = new PulsePistol();
    const combat = new Combat();
    let enemies: Crawler[] = room.enemySpawns.map((pos, i) => new Crawler(i, pos));
    let elapsedSeconds = 0;

    setMasterVolume(settingsStore.get().volume); // 正式 API；可在 AudioContext 建立前呼叫（見 synth.ts）

    // 射擊視覺回饋狀態機（見 game/effects.ts）
    const recoil = new Recoil();
    const muzzleFlash = new MuzzleFlashEffect();
    const tracer = new TracerEffect();
    const spark = new SparkEffect();
    let sparkJitterOffsets: Vec3[] = [];
    let debugFreezeFx = false;

    const input = new InputManager(canvas, (locked) => {
      // Esc 或其他方式退出 pointer lock：只有在「正在遊玩」時才視為暫停操作；menu 狀態下
      // （尚未鎖定過）不會觸發（見 core/input.ts：locked 由 true→false 才會呼叫本callback）。
      if (!locked && gameState.state === "playing") {
        gameState.pause();
      }
    });

    overlay.onStart(() => {
      gameState.start(); // menu → playing（syncUiForState 會收起主選單、顯示準星）
      input.requestPointerLock();
      resumeAudioOnGesture();
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

    /**
     * 開火成功後觸發全部視覺回饋：後座、槍口閃光一律觸發；tracer 只要開火就顯示（讓每一發
     * 「射出去」可見）；火花只在真的命中（敵人或牆面）時觸發，讓命中與未命中一眼可分。
     */
    function handleFireResult(result: FireResult): void {
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
        // 火花抖動只在觸發當下產生一次，後續幀沿用同一組偏移，避免每幀重新隨機造成雜訊閃爍；
        // 純視覺粒子噴濺，非玩法決定性資料，容許使用 Math.random()（PLAN §6.4 決定性鐵則
        // 只約束關卡佈局／碰撞／敵人與物品配置等玩法資料，不含這類一次性瞬時特效）。
        sparkJitterOffsets = Array.from({ length: SPARK_COUNT }, () => ({
          x: (Math.random() * 2 - 1) * SPARK_JITTER,
          y: (Math.random() * 2 - 1) * SPARK_JITTER,
          z: (Math.random() * 2 - 1) * SPARK_JITTER,
        }));
        spark.trigger({ point: result.hitPoint, kind: result.hitKind === "enemy" ? "enemy" : "wall" });
      }
    }

    /**
     * 重建關卡執行期狀態：玩家、敵人、武器彈藥一律從種子重建。
     * resetCombat＝true 時額外硬重置戰鬥狀態（HP／無敵／死亡旗標，供暫停選單「重新開始」
     * 使用）；自然死亡重生路徑（下方 combat.update() 觸發）已由 Combat.update() 自行處理
     * HP／死亡旗標重置，故該路徑傳 resetCombat:false 避免重複動作。
     */
    function resetLevelState(opts: { resetCombat: boolean; playSound: boolean }): void {
      player.position = { ...spawnPosition };
      player.yaw = 0;
      player.pitch = 0;
      player.velocityY = 0;
      player.grounded = false;
      enemies = room.enemySpawns.map((pos, i) => new Crawler(i, pos));
      weapon.reset();
      if (opts.resetCombat) combat.reset();
      if (opts.playSound) playRespawn();
    }

    // 4. 供 Playwright 與手動驗收讀取／操控的全域 debug hooks
    window.__p96 = {
      ready: true,
      frames: 0,
      levelHash: room.levelHash,
      get gameState() {
        return gameState.state;
      },
      enemiesAlive: () => enemies.filter((e) => e.state !== "dead").length,
      playerHp: () => combat.playerHp,
      ammo: () => weapon.ammo,
      fire: () => {
        // debug 手段：任何遊戲狀態下都直接生效，繞過真實輸入路徑的狀態閘（本次派工規格）。
        const eye = player.getEyePosition();
        const forward = forwardFromYawPitch(player.yaw, player.pitch);
        const result = weapon.tryFire(eye, forward, room.colliders, enemies);
        handleFireResult(result);
        return result.fired;
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
        // 驗收截圖用：凍結射擊特效與命中回饋計時器（後座／槍口閃光／tracer／火花／敵人
        // hitFlash／combat 無敵與紅暈都不再衰減），方便從容截圖；預設關閉，不影響正常遊玩。
        // 玩家視角／移動仍照常（simDt 只凍結「時間相關的衰減與判定」，不凍結輸入）。
        setFreezeFx: (enabled: boolean) => {
          debugFreezeFx = enabled;
        },
        teleportPlayer: (pos: Vec3) => {
          player.position = { ...pos };
        },
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
      },
    };

    // 5. 啟動主迴圈（不等待點擊／pointer lock）
    loop = new GameLoop((dt) => {
      try {
        elapsedSeconds += dt;
        const mouseDelta = input.consumeMouseDelta(); // 每幀排空，避免暫停期間堆積（見下方閘門）

        // 狀態閘：非 playing（menu／paused）時完全跳過模擬（玩家移動、武器、敵人、戰鬥、特效），
        // 只保留渲染（見上方檔頭註解與 game/state.ts）。debug hooks（fire()／damagePlayer() 等）
        // 定義在此閘門之外（見上方 window.__p96），任何狀態都能直接生效。
        if (gameState.state === "playing") {
          player.update(dt, input.state, mouseDelta, room.colliders);

          const simDt = debugFreezeFx ? 0 : dt;

          weapon.update(simDt);
          if (input.firing && weapon.canFire) {
            const eye = player.getEyePosition();
            const forward = forwardFromYawPitch(player.yaw, player.pitch);
            const result = weapon.tryFire(eye, forward, room.colliders, enemies);
            handleFireResult(result);
          }

          recoil.update(simDt);
          muzzleFlash.update(simDt);
          tracer.update(simDt);
          spark.update(simDt);

          const playerFeet = player.position;
          const playerEyeForEnemies = player.getEyePosition();
          for (const enemy of enemies) {
            const attackEvent = enemy.update(simDt, playerFeet, playerEyeForEnemies, room.colliders);
            if (attackEvent) applyDamageToPlayer(attackEvent.damage);
          }
          enemies = enemies.filter((e) => !e.removable);

          const respawnTriggered = combat.update(simDt);
          if (respawnTriggered) resetLevelState({ resetCombat: false, playSound: true });
        }

        const viewMatrix = player.getViewMatrix();
        const playerEye = player.getEyePosition();

        // 世界：地板／牆面／天花板 → 敵人 → 世界空間 FX（tracer／火花，依實際 view/projection）
        renderer.render(viewMatrix, playerEye, elapsedSeconds);
        // 面向：model matrix 加 yaw 旋轉，身體朝移動方向（e.yaw 只在 chase／retreat 實際
        // 移動時更新，見 game/enemy.ts Crawler.moveAndFace），解掉先前 translation-only 的
        // known limitation（PLAN §3.4 v4）。
        const enemyInstances: EnemyInstance[] = enemies.map((e) => ({
          model: translationRotationYMat4(e.position, e.yaw),
          dissolve: e.dissolveProgress,
          hitFlash: e.hitFlashIntensity,
        }));
        renderer.renderEnemies(viewMatrix, enemyInstances);

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

        // viewmodel（清深度蓋在世界之上，錨定畫面右下角）＋槍口閃光（viewmodel 空間 FX）
        const recoilAmount = recoil.amount;
        const viewmodelOffset: Vec3 = {
          x: VIEWMODEL_BASE_OFFSET.x,
          y: VIEWMODEL_BASE_OFFSET.y + RECOIL_KICK_Y * recoilAmount,
          z: VIEWMODEL_BASE_OFFSET.z + RECOIL_KICK_Z * recoilAmount,
        };
        renderer.renderViewmodel(translationMat4(viewmodelOffset));

        if (muzzleFlash.active) {
          const muzzleViewPos: Vec3 = {
            x: viewmodelOffset.x + pistolMesh.muzzleLocal.x,
            y: viewmodelOffset.y + pistolMesh.muzzleLocal.y,
            z: viewmodelOffset.z + pistolMesh.muzzleLocal.z - 0.02,
          };
          renderer.renderFx(
            identity(),
            identity(),
            buildQuadVertices(muzzleViewPos, MUZZLE_FLASH_HALF_SIZE, MUZZLE_FLASH_COLOR),
            "TRIANGLES",
          );
        }

        hud.updateHp(combat.playerHp, PLAYER_MAX_HP);
        hud.updateAmmo(weapon.ammo, PULSE_PISTOL_MAGAZINE);
        hud.setHurtFlash(combat.hurtFlashIntensity);
        overlay.setCrosshairHit(weapon.hitMarkerActive);
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
