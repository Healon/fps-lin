// 輸入管理：pointer lock（點 canvas 取得，Esc 由瀏覽器退出時觸發 overlay 回呼）、
// WASD、Space、滑鼠 delta。

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  pointerLocked: boolean;
}

export type PointerLockChangeCallback = (locked: boolean) => void;

export class InputManager {
  readonly state: InputState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    pointerLocked: false,
  };

  private mouseDX = 0;
  private mouseDY = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly onPointerLockChange: PointerLockChangeCallback | undefined;

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    this.setKey(e.code, true);
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.setKey(e.code, false);
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    if (!this.state.pointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private readonly handleClick = (): void => {
    this.requestPointerLock();
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.state.pointerLocked = locked;
    this.onPointerLockChange?.(locked);
  };

  constructor(canvas: HTMLCanvasElement, onPointerLockChange?: PointerLockChangeCallback) {
    this.canvas = canvas;
    this.onPointerLockChange = onPointerLockChange;

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    canvas.addEventListener("click", this.handleClick);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
  }

  private setKey(code: string, pressed: boolean): void {
    switch (code) {
      case "KeyW":
        this.state.forward = pressed;
        break;
      case "KeyS":
        this.state.back = pressed;
        break;
      case "KeyA":
        this.state.left = pressed;
        break;
      case "KeyD":
        this.state.right = pressed;
        break;
      case "Space":
        this.state.jump = pressed;
        break;
      default:
        break;
    }
  }

  /**
   * 要求 pointer lock。部分瀏覽器（含 Pointer Lock v2 草案）回傳 Promise，
   * 在分頁未聚焦、自動化測試等環境下會 reject；若不接住會變成 unhandled
   * rejection 而在瀏覽器層冒出「未捕捉錯誤」。這是預期中的非致命情境
   * （見 PLAN §8.1「headless pointer lock 可能拿不到」），一律吞下並記 warn，
   * 不視為需要顯示 overlay 錯誤畫面的失敗。
   */
  requestPointerLock(): void {
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) {
        result.catch((err: unknown) => {
          console.warn("Pointer lock 請求被拒絕（非致命）：", err);
        });
      }
    } catch (err) {
      console.warn("Pointer lock 請求拋出例外（非致命）：", err);
    }
  }

  /** 取出累積的滑鼠位移並歸零（每幀呼叫一次）。 */
  consumeMouseDelta(): { dx: number; dy: number } {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    this.canvas.removeEventListener("click", this.handleClick);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
  }
}
