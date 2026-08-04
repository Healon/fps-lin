// 共用程序化建模工具：per-face 著色的立方體生成，供敵人（crawler.ts）與武器 viewmodel
// （pistol.ts）等頂點色網格共用。禁止頂點陣列傾印：呼叫端一律傳參數化的中心／半長，
// 不得手刻頂點座標常數表（PLAN §5.2）。

import type { Vec3 } from "../../core/math.ts";

/** interleaved 頂點格式：position(3) + normal(3) + color(3) = 9 float／頂點（無 uv，純頂點色）。 */
export const COLORED_BOX_VERTEX_STRIDE = 9;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface BuildTarget {
  vertices: number[];
  indices: number[];
}

export type FaceKey = "px" | "nx" | "py" | "ny" | "pz" | "nz";

/** 附加一個依 per-face 顏色著色的立方體；faceColors 缺項回退 baseColor。 */
export function appendColoredBox(
  target: BuildTarget,
  center: Vec3,
  half: Vec3,
  baseColor: Rgb,
  faceColors?: Partial<Record<FaceKey, Rgb>>,
): void {
  const { x: cx, y: cy, z: cz } = center;
  const { x: hx, y: hy, z: hz } = half;

  const faces: { key: FaceKey; normal: [number, number, number]; corners: [number, number, number][] }[] = [
    {
      key: "px",
      normal: [1, 0, 0],
      corners: [
        [cx + hx, cy - hy, cz - hz],
        [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy + hy, cz + hz],
        [cx + hx, cy + hy, cz - hz],
      ],
    },
    {
      key: "nx",
      normal: [-1, 0, 0],
      corners: [
        [cx - hx, cy - hy, cz + hz],
        [cx - hx, cy - hy, cz - hz],
        [cx - hx, cy + hy, cz - hz],
        [cx - hx, cy + hy, cz + hz],
      ],
    },
    {
      key: "py",
      normal: [0, 1, 0],
      corners: [
        [cx - hx, cy + hy, cz - hz],
        [cx + hx, cy + hy, cz - hz],
        [cx + hx, cy + hy, cz + hz],
        [cx - hx, cy + hy, cz + hz],
      ],
    },
    {
      key: "ny",
      normal: [0, -1, 0],
      corners: [
        [cx - hx, cy - hy, cz + hz],
        [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy - hy, cz - hz],
        [cx - hx, cy - hy, cz - hz],
      ],
    },
    {
      key: "pz",
      normal: [0, 0, 1],
      corners: [
        [cx + hx, cy - hy, cz + hz],
        [cx - hx, cy - hy, cz + hz],
        [cx - hx, cy + hy, cz + hz],
        [cx + hx, cy + hy, cz + hz],
      ],
    },
    {
      key: "nz",
      normal: [0, 0, -1],
      corners: [
        [cx - hx, cy - hy, cz - hz],
        [cx + hx, cy - hy, cz - hz],
        [cx + hx, cy + hy, cz - hz],
        [cx - hx, cy + hy, cz - hz],
      ],
    },
  ];

  for (const face of faces) {
    const color = faceColors?.[face.key] ?? baseColor;
    const baseIndex = target.vertices.length / COLORED_BOX_VERTEX_STRIDE;
    for (const [px, py, pz] of face.corners) {
      const [nx, ny, nz] = face.normal;
      target.vertices.push(px, py, pz, nx, ny, nz, color.r, color.g, color.b);
    }
    target.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
  }
}
