// 最小 vec3 與 mat4：手寫，零外部數學庫依賴。
// mat4 一律 column-major Float32Array(16)，與 WebGL/GLSL 慣例一致。

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthVec3(a: Vec3): number {
  return Math.sqrt(dotVec3(a, a));
}

export function normalizeVec3(a: Vec3): Vec3 {
  const len = lengthVec3(a);
  if (len < 1e-8) return { x: 0, y: 0, z: 0 };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/** out = a * b（column-major，套用順序為先 b 後 a，符合 GLSL 慣例）。 */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function perspective(fovYRadians: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovYRadians / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const zAxis = normalizeVec3(subVec3(eye, target));
  const xAxis = normalizeVec3(crossVec3(up, zAxis));
  const yAxis = crossVec3(zAxis, xAxis);

  const out = new Float32Array(16);
  out[0] = xAxis.x;
  out[1] = yAxis.x;
  out[2] = zAxis.x;
  out[3] = 0;

  out[4] = xAxis.y;
  out[5] = yAxis.y;
  out[6] = zAxis.y;
  out[7] = 0;

  out[8] = xAxis.z;
  out[9] = yAxis.z;
  out[10] = zAxis.z;
  out[11] = 0;

  out[12] = -dotVec3(xAxis, eye);
  out[13] = -dotVec3(yAxis, eye);
  out[14] = -dotVec3(zAxis, eye);
  out[15] = 1;

  return out;
}

/** 由 yaw（水平，弧度）與 pitch（垂直，弧度）算出前方向量。yaw 0 朝 -Z，pitch 正值朝上。 */
export function forwardFromYawPitch(yaw: number, pitch: number): Vec3 {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}

/** FPS 攝影機視角矩陣：由眼睛位置加 yaw／pitch 直接建構（內部呼叫 lookAt）。 */
export function fpsViewMatrix(eye: Vec3, yaw: number, pitch: number): Mat4 {
  const forward = forwardFromYawPitch(yaw, pitch);
  const target = addVec3(eye, forward);
  return lookAt(eye, target, { x: 0, y: 1, z: 0 });
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * 由方向向量（需為單位向量）反推 yaw／pitch，為 forwardFromYawPitch 的逆運算。
 * 供 debug hook aimAt() 使用：把視角直接對準某個世界座標點。
 */
export function yawPitchFromDirection(dir: Vec3): { yaw: number; pitch: number } {
  const pitch = Math.asin(clampUnit(dir.y));
  const yaw = Math.atan2(-dir.x, -dir.z);
  return { yaw, pitch };
}

export function translationMat4(t: Vec3): Mat4 {
  const out = identity();
  out[12] = t.x;
  out[13] = t.y;
  out[14] = t.z;
  return out;
}

/** 繞 Y 軸旋轉（yaw，弧度）的矩陣，慣例與 forwardFromYawPitch 一致：yaw 0 朝 -Z。 */
export function rotationYMat4(yaw: number): Mat4 {
  const out = identity();
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[0] = c;
  out[2] = -s;
  out[8] = s;
  out[10] = c;
  return out;
}

/** 位移加繞 Y 軸旋轉的組合矩陣（先旋轉、後平移），供敵人等需面向移動方向的實體使用。 */
export function translationRotationYMat4(t: Vec3, yaw: number): Mat4 {
  return multiply(translationMat4(t), rotationYMat4(yaw));
}
