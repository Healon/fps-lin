// FPS 玩家控制器：yaw/pitch 視角、移動、重力與跳躍、AABB 逐軸碰撞解算。
// 數值取自 PLAN §3.2：移速 6 m/s、重力 20 m/s²、跳高 1.2m、眼高 1.7m。

import type { Vec3, Mat4 } from "../core/math.ts";
import { fpsViewMatrix } from "../core/math.ts";
import type { InputState } from "../core/input.ts";
import type { Aabb } from "../procgen/level/room.ts";

const MOVE_SPEED = 6.0; // m/s，相機平面投影
const GRAVITY = 20.0; // m/s^2
const JUMP_HEIGHT = 1.2; // m
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
const EYE_HEIGHT = 1.7; // m
const PLAYER_HALF: Vec3 = { x: 0.4, y: 0.9, z: 0.4 }; // 對應 0.8×1.8×0.8 AABB
const PITCH_LIMIT = (89 * Math.PI) / 180;
const MOUSE_SENSITIVITY = 0.0022;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function aabbOverlap(aMin: Vec3, aMax: Vec3, bMin: Vec3, bMax: Vec3): boolean {
  return (
    aMin.x < bMax.x &&
    aMax.x > bMin.x &&
    aMin.y < bMax.y &&
    aMax.y > bMin.y &&
    aMin.z < bMax.z &&
    aMax.z > bMin.z
  );
}

type Axis = "x" | "y" | "z";

/**
 * 沿單一軸移動並解算碰撞：以完整位移量做廣義判定，命中時把該軸位移量夾在
 * 碰到邊界之前（標準的逐軸 AABB 解算，適合本專案的低速場景，不做完整 swept AABB）。
 */
function resolveAxisMove(center: Vec3, half: Vec3, axis: Axis, delta: number, colliders: Aabb[]): { delta: number; hit: boolean } {
  if (delta === 0) return { delta: 0, hit: false };

  const moved: Vec3 = { ...center, [axis]: center[axis] + delta };
  const movedMin: Vec3 = { x: moved.x - half.x, y: moved.y - half.y, z: moved.z - half.z };
  const movedMax: Vec3 = { x: moved.x + half.x, y: moved.y + half.y, z: moved.z + half.z };

  let clampedDelta = delta;
  let hit = false;

  for (const collider of colliders) {
    if (!aabbOverlap(movedMin, movedMax, collider.min, collider.max)) continue;

    if (delta > 0) {
      const allowed = collider.min[axis] - half[axis] - center[axis];
      if (allowed < clampedDelta) clampedDelta = Math.max(0, allowed);
    } else {
      const allowed = collider.max[axis] + half[axis] - center[axis];
      if (allowed > clampedDelta) clampedDelta = Math.min(0, allowed);
    }
    hit = true;
  }

  return { delta: clampedDelta, hit };
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

    // 起跳：只有在著地狀態才可跳
    if (input.jump && this.grounded) {
      this.velocityY = JUMP_SPEED;
      this.grounded = false;
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
