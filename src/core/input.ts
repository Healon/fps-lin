// 輸入管理：pointer lock（點 canvas 取得，Esc 由瀏覽器退出時觸發 overlay 回呼）、
// WASD 移動、方向鍵視角（無滑鼠替代）、空白鍵或左鍵射擊、滑鼠 delta。無跳躍（D-005）。

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  lookLeft: boolean;
  lookRight: boolean;
  lookUp: boolean;
  lookDown: boolean;
  pointerLocked: boolean;
  /** 左鍵或空白鍵按住＝持續開火（實際射速仍由武器冷卻限制，見 game/weapons.ts）。 */
  fire: boolean;
  /** 空白鍵獨立追蹤，與滑鼠左鍵分開，避免互相蓋掉對方的放開事件。 */
  fireKey: boolean;
}

export type PointerLockChangeCallback = (locked: boolean) => void;

export class InputManager {
  readonly state: InputState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    lookLeft: false,
    lookRight: false,
    lookUp: false,
    lookDown: false,
    pointerLocked: false,
    fire: false,
    fireKey: false,
  };

  /** 是否處於開火輸入（滑鼠左鍵或空白鍵任一按住）。 */
  get firing(): boolean {
    return this.state.fire || this.state.fireKey;
  }

  private mouseDX = 0;
  private mouseDY = 0;
  /** 數字鍵 1／2／3／4（切換武器）為邊緣觸發（keydown 當下才記一次，非按住持續觸發），
   *  M2 新增（1／2），M3 第二階段新增 3（電漿步槍），M3 第三階段新增 4（能量砲）；
   *  每幀由 consumeWeaponSwitch() 讀取並清空，同 consumeMouseDelta() 慣例。 */
  private pendingWeaponSwitch: 1 | 2 | 3 | 4 | null = null;
  /** E 鍵（互動：控制台等）邊緣觸發，M3 新增；每幀由 consumeInteract() 讀取並清空，
   *  同 consumeWeaponSwitch() 慣例。只在 gameState === "playing" 時由呼叫端（main.ts）套用生效，
   *  本類別自身不知道遊戲狀態（同其餘輸入慣例）。 */
  private pendingInteract = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly onPointerLockChange: PointerLockChangeCallback | undefined;

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Digit1") {
      this.pendingWeaponSwitch = 1;
      e.preventDefault();
      return;
    }
    if (e.code === "Digit2") {
      this.pendingWeaponSwitch = 2;
      e.preventDefault();
      return;
    }
    if (e.code === "Digit3") {
      this.pendingWeaponSwitch = 3;
      e.preventDefault();
      return;
    }
    if (e.code === "Digit4") {
      this.pendingWeaponSwitch = 4;
      e.preventDefault();
      return;
    }
    if (e.code === "KeyE") {
      this.pendingInteract = true;
      e.preventDefault();
      return;
    }
    if (this.setKey(e.code, true)) e.preventDefault();
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    if (this.setKey(e.code, false)) e.preventDefault();
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    if (!this.state.pointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  /**
   * 左鍵按下：尚未鎖定時視為「點擊進入」手勢，要求 pointer lock；已鎖定時視為開火按住。
   * 只處理左鍵（button 0），避免右鍵／中鍵誤觸發。
   */
  private readonly handleMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if (!this.state.pointerLocked) {
      this.requestPointerLock();
    } else {
      this.state.fire = true;
    }
  };

  private readonly handleMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    this.state.fire = false;
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.state.pointerLocked = locked;
    if (!locked) {
      this.state.fire = false; // Esc 退出鎖定時，避免開火狀態卡在 true
      this.state.fireKey = false;
    }
    this.onPointerLockChange?.(locked);
  };

  constructor(canvas: HTMLCanvasElement, onPointerLockChange?: PointerLockChangeCallback) {
    this.canvas = canvas;
    this.onPointerLockChange = onPointerLockChange;

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    canvas.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
  }

  /** 回傳是否為本遊戲處理的按鍵（供呼叫端決定是否 preventDefault，擋掉空白鍵與方向鍵的頁面捲動）。 */
  private setKey(code: string, pressed: boolean): boolean {
    switch (code) {
      case "KeyW":
        this.state.forward = pressed;
        return true;
      case "KeyS":
        this.state.back = pressed;
        return true;
      case "KeyA":
        this.state.left = pressed;
        return true;
      case "KeyD":
        this.state.right = pressed;
        return true;
      case "Space":
        this.state.fireKey = pressed;
        return true;
      case "ArrowLeft":
        this.state.lookLeft = pressed;
        return true;
      case "ArrowRight":
        this.state.lookRight = pressed;
        return true;
      case "ArrowUp":
        this.state.lookUp = pressed;
        return true;
      case "ArrowDown":
        this.state.lookDown = pressed;
        return true;
      default:
        return false;
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

  /** 取出並清空數字鍵 1／2／3／4 的待處理武器切換請求（每幀呼叫一次，邊緣觸發，M2 新增 1／2，
   *  M3 第二階段新增 3，M3 第三階段新增 4）。 */
  consumeWeaponSwitch(): 1 | 2 | 3 | 4 | null {
    const req = this.pendingWeaponSwitch;
    this.pendingWeaponSwitch = null;
    return req;
  }

  /** 取出並清空 E 鍵的待處理互動請求（每幀呼叫一次，邊緣觸發，M3 新增）。 */
  consumeInteract(): boolean {
    const req = this.pendingInteract;
    this.pendingInteract = false;
    return req;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
  }
}
