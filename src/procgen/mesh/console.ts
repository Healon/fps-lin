// 控制台程序化網格（M3 新增）：斜面操作台加能源青發光面板，區域 D 開門機關的視覺呈現。
// appendColoredBox 不支援任意旋轉（同 crawler.ts 檔頭註解），斜面以「逐層薄板向前偏移堆疊」
// 近似傾斜視覺（低多邊形風格化的合理妥協，同 crawler.ts 駝背前傾的作法）。
// 局部座標系：中心 (0, 0, 0) 即基座底部貼齊 y=0（地面），與 ConsoleDef.pos（世界座標）對齊。
// 提供 idle／active 兩個版本（面板顏色不同），main.ts 依 ConsoleSystem.isActivated 切換
// 對應的 prop 渲染 key，達成「啟動後面板變色」而不需 renderer 額外的 per-instance tint uniform。

import { stream } from "../../rng/rng.ts";
import { appendColoredBox, COLORED_BOX_VERTEX_STRIDE, type BuildTarget, type Rgb } from "./box.ts";

export const CONSOLE_VERTEX_STRIDE = COLORED_BOX_VERTEX_STRIDE;

export interface ConsoleMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

const METAL_COLOR: Rgb = { r: 0x1a / 255, g: 0x1d / 255, b: 0x21 / 255 };
const METAL_HIGHLIGHT: Rgb = { r: 0x2c / 255, g: 0x30 / 255, b: 0x36 / 255 };
const PANEL_IDLE_COLOR: Rgb = { r: 0x1c / 255, g: 0x5a / 255, b: 0x66 / 255 }; // 暗青，未啟動
const PANEL_ACTIVE_COLOR: Rgb = { r: 0x9b / 255, g: 0xff / 255, b: 0xe0 / 255 }; // 亮青白，已啟動

/**
 * 生成控制台網格：矮胖基座（深色金屬）加四層漸縮向前偏移的薄板堆疊出的斜面操作台，
 * 頂層面板依 activated 決定顏色（未啟動＝暗青，已啟動＝亮青白，供 main.ts 切換視覺回饋）。
 * 種子固定 stream('prop.console')，純外觀層，禁止 Math.random／Date。
 */
export function generateConsoleMesh(activated: boolean): ConsoleMesh {
  stream("prop.console");
  const target: BuildTarget = { vertices: [], indices: [] };

  const baseHalf = { x: 0.55, y: 0.42, z: 0.4 };
  appendColoredBox(target, { x: 0, y: baseHalf.y, z: 0 }, baseHalf, METAL_COLOR);

  const slabCount = 4;
  const slabHalfY = 0.05;
  const panelColor = activated ? PANEL_ACTIVE_COLOR : PANEL_IDLE_COLOR;
  let topY = baseHalf.y * 2;
  for (let i = 0; i < slabCount; i++) {
    const frontOffset = -0.06 * i; // 每層略向前（-Z）偏移，堆疊出視覺斜面
    const slabHalf = { x: baseHalf.x * 0.92, y: slabHalfY, z: 0.34 - i * 0.02 };
    const slabCenter = { x: 0, y: topY + slabHalfY, z: frontOffset };
    const isTop = i === slabCount - 1;
    appendColoredBox(target, slabCenter, slabHalf, METAL_HIGHLIGHT, isTop ? { py: panelColor } : undefined);
    topY += slabHalfY * 2;
  }

  return { vertices: new Float32Array(target.vertices), indices: new Uint32Array(target.indices) };
}
