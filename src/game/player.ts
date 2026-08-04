// FPS 玩家控制器：yaw/pitch 視角（滑鼠或方向鍵）、移動、重力、AABB 逐軸碰撞解算。
// 數值取自 PLAN §3.2：移速 6 m/s、重力 20 m/s²、眼高 1.7m。無跳躍（D-005）。

import type { Vec3, Mat4 } from "../core/math.ts";
import { fpsViewMatrix } from "../core/math.ts";
import type { InputState } from "../core/input.ts";
import type { Aabb } from "../procgen/level/room.ts";
import { resolveAxisMove } from "./collision.ts";

const MOVE_SPEED = 6.0; // m/s，相機平面投影
const GRAVITY = 20.0; // m/s^2（無跳躍，但保留重力讓玩家貼地並支援日後高低差）
const EYE_HEIGHT = 1.7; // m
const KEY_YAW_SPEED = 2.8; // rad/s，方向鍵水平轉速
const KEY_PITCH_SPEED = 1.8; // rad/s，方向鍵俯仰轉速
const PLAYER_HALF: Vec3 = { x: 0.4, y: 0.9, z: 0.4 }; // 對應 0.8×1.8×0.8 AABB
export const PITCH_LIMIT = (89 * Math.PI) / 180;
const MOUSE_SENSITIVITY = 0.0022;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class PlayerController {
  /** 腳底（地面接觸點）位置，非眼睛位置。 */
  position: Vec3;
  yaw = 0;
  pitch = 0;
  velocityY = 0;
  grounded = false;

  constructor(startPosition: Vec3) {
    this.position = { ...startPosition };
  }

  private applyLook(mouseDX: number, mouseDY: number): void {
    this.yaw -= mouseDX * MOUSE_SENSITIVITY;
    this.pitch -= mouseDY * MOUSE_SENSITIVITY;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  update(dt: number, input: InputState, mouseDelta: { dx: number; dy: number }, colliders: Aabb[]): void {
    this.applyLook(mouseDelta.dx, mouseDelta.dy);

    // 方向鍵視角（無滑鼠時的替代操控，與滑鼠疊加）
    if (input.lookLeft) this.yaw += KEY_YAW_SPEED * dt;
    if (input.lookRight) this.yaw -= KEY_YAW_SPEED * dt;
    if (input.lookUp) this.pitch += KEY_PITCH_SPEED * dt;
    if (input.lookDown) this.pitch -= KEY_PITCH_SPEED * dt;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);

    // 依 yaw 建立水平前／右方向（忽略 pitch，符合 FPS 慣例的地面移動）
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let moveX = 0;
    let moveZ = 0;
    if (input.forward) {
      moveX += forwardX;
      moveZ += forwardZ;
    }
    if (input.back) {
      moveX -= forwardX;
      moveZ -= forwardZ;
    }
    if (input.right) {
      moveX += rightX;
      moveZ += rightZ;
    }
    if (input.left) {
      moveX -= rightX;
      moveZ -= rightZ;
    }

    const moveLen = Math.hypot(moveX, moveZ);
    if (moveLen > 1e-6) {
      moveX = (moveX / moveLen) * MOVE_SPEED * dt;
      moveZ = (moveZ / moveLen) * MOVE_SPEED * dt;
    }

    this.velocityY -= GRAVITY * dt;
    const moveY = this.velocityY * dt;

    // center = 腳底 + 半高偏移
    let center: Vec3 = {
      x: this.position.x,
      y: this.position.y + PLAYER_HALF.y,
      z: this.position.z,
    };

    const resolvedX = resolveAxisMove(center, PLAYER_HALF, "x", moveX, colliders);
    center = { ...center, x: center.x + resolvedX.delta };

    const resolvedZ = resolveAxisMove(center, PLAYER_HALF, "z", moveZ, colliders);
    center = { ...center, z: center.z + resolvedZ.delta };

    const resolvedY = resolveAxisMove(center, PLAYER_HALF, "y", moveY, colliders);
    center = { ...center, y: center.y + resolvedY.delta };

    if (resolvedY.hit) {
      if (moveY <= 0) {
        this.grounded = true;
      }
      this.velocityY = 0;
    } else {
      this.grounded = false;
    }

    this.position = {
      x: center.x,
      y: center.y - PLAYER_HALF.y,
      z: center.z,
    };
  }

  getEyePosition(): Vec3 {
    return { x: this.position.x, y: this.position.y + EYE_HEIGHT, z: this.position.z };
  }

  getViewMatrix(): Mat4 {
    return fpsViewMatrix(this.getEyePosition(), this.yaw, this.pitch);
  }
}
