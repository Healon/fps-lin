// boot 流程：生成關卡 → 生成材質 → 初始化 GL 與 buffer → 設 window.__p96 → 啟動迴圈。
// 渲染迴圈不等點擊就開跑（點擊只負責 pointer lock），讓自動化測試不需手勢即可驗 frames。
// 任何 boot 或執行期錯誤一律顯示在 overlay 上，禁止靜默失敗。

import { generateTestRoom } from "./procgen/level/room.ts";
import { generateMetalWallTexture, TEXTURE_SIZE } from "./procgen/texture/noise.ts";
import { Renderer } from "./gfx/renderer.ts";
import { InputManager } from "./core/input.ts";
import { GameLoop } from "./core/loop.ts";
import { PlayerController } from "./game/player.ts";
import { Overlay } from "./ui/overlay.ts";

declare global {
  interface Window {
    __p96?: {
      ready: boolean;
      frames: number;
      levelHash: string;
    };
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.message}\n${err.stack ?? ""}`;
  return String(err);
}

function boot(): void {
  const overlay = new Overlay();
  let loop: GameLoop | null = null;

  try {
    const canvas = document.getElementById("glcanvas") as HTMLCanvasElement | null;
    if (!canvas) throw new Error("找不到 #glcanvas 元素。");

    // 1. CPU 生成關卡資料（純決定性：碰撞 AABB、levelHash）
    const room = generateTestRoom();

    // 2. 生成材質（外觀，M0 用 CPU noise 加 ramp，見 procgen/texture/noise.ts 註解）
    const texture = generateMetalWallTexture(TEXTURE_SIZE);

    // 3. 初始化 WebGL2 與 buffer
    const renderer = new Renderer(canvas);
    renderer.uploadGeometry(room.vertices, room.indices);
    renderer.uploadTexture(texture.size, texture.pixels);

    const player = new PlayerController({ x: 0, y: room.floorY, z: 7 });

    const input = new InputManager(canvas, (locked) => {
      if (!locked) overlay.show();
    });

    overlay.onStart(() => {
      overlay.hide();
      input.requestPointerLock();
    });

    // 4. 供 Playwright smoke test 讀取的全域狀態
    window.__p96 = {
      ready: true,
      frames: 0,
      levelHash: room.levelHash,
    };

    // 5. 啟動主迴圈（不等待點擊／pointer lock）
    loop = new GameLoop((dt) => {
      try {
        const mouseDelta = input.consumeMouseDelta();
        player.update(dt, input.state, mouseDelta, room.colliders);
        renderer.render(player.getViewMatrix(), player.getEyePosition());
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
