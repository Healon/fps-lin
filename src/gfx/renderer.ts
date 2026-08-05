// 前向渲染器：MVP 變換、貼圖取樣、方向光加環境光、遠處霧化淡出。地板與牆面（含障礙箱）
// 分屬兩份獨立幾何與材質（floor_flagstone／castle_wall），各自一次 draw call；敵人另用頂點色
// shader。PLAN §5.1 v3（2026-08-04 依 Lin 驗收回饋修訂）：氛圍改走恐懼與城堡石材，環境光下調
// 並帶冷灰偏、霧色改冷黑加密度上調、火光琥珀光帶帶 uTime 微閃爍、暗角疊圖（見 ui/hud.ts）。

import { createGL2Context, createProgram, createVAO, createTexture2D, type AttribLayout } from "./gl.ts";
import { perspective, identity, type Mat4, type Vec3 } from "../core/math.ts";
import { VERTEX_STRIDE } from "../procgen/level/level.ts";
import { CRAWLER_VERTEX_STRIDE, WARNING_COLOR } from "../procgen/mesh/crawler.ts";
import { PISTOL_VERTEX_STRIDE } from "../procgen/mesh/pistol.ts";
import { SHOTGUN_VERTEX_STRIDE } from "../procgen/mesh/shotgun.ts";
import { DOOR_VERTEX_STRIDE } from "../procgen/mesh/door.ts";

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

out vec3 vNormal;
out vec2 vUv;
out vec3 vWorldPos;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = mat3(uModel) * aNormal;
  vUv = aUv;
  gl_Position = uProjection * uView * worldPos;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec2 vUv;
in vec3 vWorldPos;

uniform sampler2D uTexture;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform vec3 uAmbientColor;
uniform vec3 uLightColor;
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
// 供天花板重用牆面材質時整體壓暗一階用（1.0＝原樣，見 renderCeiling 的 CEILING_BRIGHTNESS）。
uniform float uBrightness;
uniform float uTime;

out vec4 fragColor;

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, -normalize(uLightDir)), 0.0);

  vec4 texColor = texture(uTexture, vUv);
  // 環境光（冷灰偏，uAmbientColor）加方向光（暖色調 uLightColor）：冷陰影加暖高光的對比，
  // 呼應 PLAN §5.1 v3「恐懼而非溫馨」的城堡火把氛圍。
  vec3 lit = texColor.rgb * uAmbient * uAmbientColor + texColor.rgb * diffuse * (1.0 - uAmbient) * uLightColor;

  // 火把感微閃爍：低頻疊加＋偶發短暫下沉，範圍約 0.8～1.0，避免頻閃刺眼（無高頻成分）。
  float flickerSlow = sin(uTime * 1.1);
  float flickerFast = sin(uTime * 2.6 + 1.3);
  float flickerBase = 0.925 + 0.06 * flickerSlow + 0.03 * flickerFast;
  float dipPulse = pow(max(sin(uTime * 0.23 + 2.0), 0.0), 8.0);
  float flicker = clamp(flickerBase - dipPulse * 0.12, 0.8, 1.0);

  lit = lit * uBrightness * flicker;

  float dist = length(vWorldPos - uCameraPos);
  float fogFactor = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  vec3 finalColor = mix(lit, uFogColor, fogFactor);

  fragColor = vec4(finalColor, 1.0);
}
`;

const LAYOUT: AttribLayout[] = [
  { name: "aPosition", size: 3, offsetFloats: 0 },
  { name: "aNormal", size: 3, offsetFloats: 3 },
  { name: "aUv", size: 2, offsetFloats: 6 },
];

// M1：敵人（巡行體）用獨立的頂點色 shader，無 uv／texture sampler，
// 額外支援 uDissolve（死亡溶解淡出，趨近霧色）。
const ENEMY_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

out vec3 vNormal;
out vec3 vColor;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  gl_Position = uProjection * uView * worldPos;
}
`;

const ENEMY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;

uniform vec3 uLightDir;
uniform float uAmbient;
uniform vec3 uLightColor;
uniform vec3 uFogColor;
uniform float uDissolve;
// 受擊閃光（0～1，hurt 進入時設 1 隨時間衰減，見 game/enemy.ts hitFlashIntensity）。
uniform float uHitFlash;
// 警示橘自發光判定：與此顏色夠接近的頂點色視為警示面，不受環境壓暗影響，維持可讀性紅線。
uniform vec3 uWarningColor;
// 蓄力 telegraph（0～1，M3 新增：射擊體 windup 時橘光增強，見 game/spitter.ts telegraphIntensity；
// 非 windup 或非射擊體實例一律傳 0，只影響警示橘部位，不與 uHitFlash 的整體混白效果混淆）。
uniform float uTelegraph;

out vec4 fragColor;

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, -normalize(uLightDir)), 0.0);
  vec3 litNormal = vColor * uAmbient + vColor * diffuse * (1.0 - uAmbient) * uLightColor;

  float isWarning = 1.0 - step(0.08, distance(vColor, uWarningColor));
  vec3 lit = mix(litNormal, uWarningColor, isWarning);

  vec3 hotWarning = clamp(uWarningColor * 1.8, 0.0, 1.0);
  lit = mix(lit, hotWarning, isWarning * clamp(uTelegraph, 0.0, 1.0));

  lit = mix(lit, vec3(1.0), clamp(uHitFlash, 0.0, 1.0) * 0.75);
  vec3 finalColor = mix(lit, uFogColor, clamp(uDissolve, 0.0, 1.0));
  fragColor = vec4(finalColor, 1.0);
}
`;

const ENEMY_LAYOUT: AttribLayout[] = [
  { name: "aPosition", size: 3, offsetFloats: 0 },
  { name: "aNormal", size: 3, offsetFloats: 3 },
  { name: "aColor", size: 3, offsetFloats: 6 },
];

// M1 射擊視覺回饋（Lin 反饋「開槍看不見、命中看不見」）：無光照、純色 quad／line／point 的
// 極簡 shader，供槍口閃光、彈道 tracer、命中火花共用一條動態頂點緩衝（每次繪製前整批更新，
// 資料量極小，效能無虞）。
const FX_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

out vec4 vColor;

void main() {
  vColor = aColor;
  gl_PointSize = 14.0;
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}
`;

const FX_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
}
`;

/** interleaved：position(3) + color(4，含 alpha) = 7 float／頂點。 */
const FX_VERTEX_STRIDE = 7;

export type FxPrimitiveMode = "LINES" | "TRIANGLES" | "POINTS";

export interface EnemyInstance {
  /** 敵人網格鍵值（M3 新增：'crawler'／'spitter'，見 Renderer.uploadEnemyGeometry）。 */
  mesh: string;
  model: Mat4;
  /** 0（正常）至 1（完全溶解，趨近霧色）。 */
  dissolve: number;
  /** 0（正常）至 1（剛受擊，混白）。 */
  hitFlash: number;
  /** 0（正常）至 1（蓄力中，橘光增強，M3 新增，僅射擊體使用）；省略時視為 0。 */
  telegraph?: number;
}

// 天花板重用 texture.castle_wall（不另開材質種子），繪製時整體壓暗一階。
const CEILING_BRIGHTNESS = 0.6;
// viewmodel 額外補光下限：避免因場景整體壓暗（v3 恐懼美術方向）而看不清手上的槍。
const VIEWMODEL_MIN_AMBIENT = 0.6;

export interface RendererConfig {
  fogColor: Vec3; // 對應 PLAN §5.1 v3 底黑（冷）#0A0908
  fogNear: number;
  fogFar: number;
  lightDir: Vec3;
  /** 方向光色調，暖色調（PLAN §5.1 v3 火光琥珀 #D98A2B 方向），非全彩重著色。 */
  lightColor: Vec3;
  /** 環境光色調，冷灰偏，與 lightColor 形成冷陰影加暖高光的對比（恐懼氛圍）。 */
  ambientColor: Vec3;
  ambient: number;
}

// 2026-08-04 v3 依 Lin 驗收回饋（「太木質化太溫馨，要恐懼」）修訂：環境光下調約 25% 並帶冷灰偏、
// 霧色改冷黑、霧密度上調（遠端明顯沒入黑暗）。見 PLAN §5.1 v3 修訂紀錄。
export const DEFAULT_RENDERER_CONFIG: RendererConfig = {
  fogColor: { x: 0x0a / 255, y: 0x09 / 255, z: 0x08 / 255 },
  fogNear: 9,
  fogFar: 24,
  lightDir: { x: -0.4, y: -1, z: -0.3 },
  lightColor: { x: 1.0, y: 0.8, z: 0.52 },
  ambientColor: { x: 0.85, y: 0.9, z: 1.0 },
  ambient: 0.52, // 2026-08-05 由 0.36 上調至 0.44 再依 Lin 指定調至 0.52，恐懼氛圍靠對比與光池維持，不靠全黑
};

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly config: RendererConfig;

  // 地板（texture.floor_planks）與牆面＋障礙箱（texture.stone_wall）各自獨立 VAO／texture，
  // 共用同一個 program／uniform 版面（僅 uModel／texture 綁定逐組不同）。
  private floorVao: WebGLVertexArrayObject | null = null;
  private floorIndexCount = 0;
  private floorTexture: WebGLTexture | null = null;
  private wallVao: WebGLVertexArrayObject | null = null;
  private wallIndexCount = 0;
  private wallTexture: WebGLTexture | null = null;
  // 天花板：重用 wallTexture（不另開材質種子），繪製時以 uBrightness 整體壓暗一階。
  private ceilingVao: WebGLVertexArrayObject | null = null;
  private ceilingIndexCount = 0;
  private projection: Mat4 = identity();
  /** FOV（度）。PLAN §3.2：預設 90，可調 70 至 110；套用經 setFov()（core/settings.ts）。 */
  private fovDegrees = 90;

  private readonly uniformLocations: Record<string, WebGLUniformLocation | null>;

  // M1：敵人（頂點色，無材質）獨立 program／VAO；viewmodel（第一人稱手槍）重用同一 program。
  // M3：敵人網格改為 key 查表（Map），支援多種敵人剪影（crawler／spitter）共用同一 program，
  // 各自獨立 VAO，逐實例依 EnemyInstance.mesh 選取（同 propVaos 的通用 key 查表慣例）。
  private readonly enemyProgram: WebGLProgram;
  private readonly enemyUniformLocations: Record<string, WebGLUniformLocation | null>;
  private readonly enemyMeshes = new Map<string, { vao: WebGLVertexArrayObject; indexCount: number }>();
  private viewmodelVao: WebGLVertexArrayObject | null = null;
  private viewmodelIndexCount = 0;
  // M2：散射槍 viewmodel 另一份幾何（同 program／頂點格式，依目前裝備武器擇一繪製，見 renderViewmodel）。
  private shotgunViewmodelVao: WebGLVertexArrayObject | null = null;
  private shotgunViewmodelIndexCount = 0;

  // M2：通用「頂點色 prop」實例系統，供門板／撿取物浮動圖示等共用（同 enemyProgram／頂點格式，
  // 依 key 查表取用對應 VAO，逐實例只換 uModel）。避免每種 prop 各開一條新 shader pipeline。
  private readonly propVaos = new Map<string, { vao: WebGLVertexArrayObject; indexCount: number }>();

  // 射擊視覺回饋（槍口閃光／tracer／火花）共用的極簡無光照 pipeline，動態頂點緩衝。
  private readonly fxProgram: WebGLProgram;
  private readonly fxUniformLocations: Record<string, WebGLUniformLocation | null>;
  private fxVao: WebGLVertexArrayObject | null = null;
  private fxVertexBuffer: WebGLBuffer | null = null;

  constructor(canvas: HTMLCanvasElement, config: RendererConfig = DEFAULT_RENDERER_CONFIG) {
    this.canvas = canvas;
    this.config = config;
    this.gl = createGL2Context(canvas);
    this.program = createProgram(this.gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.enemyProgram = createProgram(this.gl, ENEMY_VERTEX_SHADER, ENEMY_FRAGMENT_SHADER);
    this.fxProgram = createProgram(this.gl, FX_VERTEX_SHADER, FX_FRAGMENT_SHADER);

    const gl = this.gl;
    this.uniformLocations = {
      uModel: gl.getUniformLocation(this.program, "uModel"),
      uView: gl.getUniformLocation(this.program, "uView"),
      uProjection: gl.getUniformLocation(this.program, "uProjection"),
      uTexture: gl.getUniformLocation(this.program, "uTexture"),
      uLightDir: gl.getUniformLocation(this.program, "uLightDir"),
      uAmbient: gl.getUniformLocation(this.program, "uAmbient"),
      uAmbientColor: gl.getUniformLocation(this.program, "uAmbientColor"),
      uLightColor: gl.getUniformLocation(this.program, "uLightColor"),
      uCameraPos: gl.getUniformLocation(this.program, "uCameraPos"),
      uFogColor: gl.getUniformLocation(this.program, "uFogColor"),
      uFogNear: gl.getUniformLocation(this.program, "uFogNear"),
      uFogFar: gl.getUniformLocation(this.program, "uFogFar"),
      uBrightness: gl.getUniformLocation(this.program, "uBrightness"),
      uTime: gl.getUniformLocation(this.program, "uTime"),
    };
    this.enemyUniformLocations = {
      uModel: gl.getUniformLocation(this.enemyProgram, "uModel"),
      uView: gl.getUniformLocation(this.enemyProgram, "uView"),
      uProjection: gl.getUniformLocation(this.enemyProgram, "uProjection"),
      uLightDir: gl.getUniformLocation(this.enemyProgram, "uLightDir"),
      uAmbient: gl.getUniformLocation(this.enemyProgram, "uAmbient"),
      uLightColor: gl.getUniformLocation(this.enemyProgram, "uLightColor"),
      uFogColor: gl.getUniformLocation(this.enemyProgram, "uFogColor"),
      uDissolve: gl.getUniformLocation(this.enemyProgram, "uDissolve"),
      uHitFlash: gl.getUniformLocation(this.enemyProgram, "uHitFlash"),
      uWarningColor: gl.getUniformLocation(this.enemyProgram, "uWarningColor"),
      uTelegraph: gl.getUniformLocation(this.enemyProgram, "uTelegraph"),
    };
    this.fxUniformLocations = {
      uModel: gl.getUniformLocation(this.fxProgram, "uModel"),
      uView: gl.getUniformLocation(this.fxProgram, "uView"),
      uProjection: gl.getUniformLocation(this.fxProgram, "uProjection"),
    };

    // FX 動態頂點緩衝：非索引繪製（drawArrays），VAO 手動建立（createVAO 是為索引幾何設計的）。
    this.fxVao = gl.createVertexArray();
    gl.bindVertexArray(this.fxVao);
    this.fxVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fxVertexBuffer);
    const fxStrideBytes = FX_VERTEX_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, fxStrideBytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, fxStrideBytes, 3 * 4);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(this.config.fogColor.x, this.config.fogColor.y, this.config.fogColor.z, 1);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  uploadFloorGeometry(vertices: Float32Array, indices: Uint32Array): void {
    const { vao, indexCount } = createVAO(this.gl, this.program, vertices, indices, VERTEX_STRIDE, LAYOUT);
    this.floorVao = vao;
    this.floorIndexCount = indexCount;
  }

  uploadFloorTexture(size: number, pixels: Uint8Array): void {
    this.floorTexture = createTexture2D(this.gl, size, size, pixels);
  }

  uploadWallGeometry(vertices: Float32Array, indices: Uint32Array): void {
    const { vao, indexCount } = createVAO(this.gl, this.program, vertices, indices, VERTEX_STRIDE, LAYOUT);
    this.wallVao = vao;
    this.wallIndexCount = indexCount;
  }

  uploadWallTexture(size: number, pixels: Uint8Array): void {
    this.wallTexture = createTexture2D(this.gl, size, size, pixels);
  }

  /** 天花板幾何：無獨立 texture 上傳方法，繪製時直接重用 wallTexture（見 render()）。 */
  uploadCeilingGeometry(vertices: Float32Array, indices: Uint32Array): void {
    const { vao, indexCount } = createVAO(this.gl, this.program, vertices, indices, VERTEX_STRIDE, LAYOUT);
    this.ceilingVao = vao;
    this.ceilingIndexCount = indexCount;
  }

  /**
   * 上傳一種敵人網格並登記 key（M3 泛化：crawler／spitter 各自一份 VAO，共用同一
   * enemyProgram／頂點色格式）。同一 key 重複上傳會覆蓋（呼叫端負責不重複上傳同一 key）。
   */
  uploadEnemyGeometry(key: string, vertices: Float32Array, indices: Uint32Array): void {
    const { vao, indexCount } = createVAO(
      this.gl,
      this.enemyProgram,
      vertices,
      indices,
      CRAWLER_VERTEX_STRIDE,
      ENEMY_LAYOUT,
    );
    this.enemyMeshes.set(key, { vao, indexCount });
  }

  /** 上傳第一人稱武器 viewmodel 幾何（重用敵人的頂點色 program／頂點格式）。 */
  uploadViewmodelGeometry(vertices: Float32Array, indices: Uint32Array): void {
    const { vao, indexCount } = createVAO(
      this.gl,
      this.enemyProgram,
      vertices,
      indices,
      PISTOL_VERTEX_STRIDE,
      ENEMY_LAYOUT,
    );
    this.viewmodelVao = vao;
    this.viewmodelIndexCount = indexCount;
  }

  /** 上傳散射槍 viewmodel 幾何（M2 新增；武器切換時 renderViewmodel 依 weaponId 擇一繪製）。 */
  uploadShotgunViewmodelGeometry(vertices: Float32Array, indices: Uint32Array): void {
    const { vao, indexCount } = createVAO(
      this.gl,
      this.enemyProgram,
      vertices,
      indices,
      SHOTGUN_VERTEX_STRIDE,
      ENEMY_LAYOUT,
    );
    this.shotgunViewmodelVao = vao;
    this.shotgunViewmodelIndexCount = indexCount;
  }

  /**
   * 上傳一份 prop 幾何並登記 key（M2 新增：門板、撿取物浮動圖示等共用頂點色 program）。
   * 同一 key 重複上傳會覆蓋（呼叫端負責不重複上傳同一 key）。
   */
  uploadPropGeometry(key: string, vertices: Float32Array, indices: Uint32Array): void {
    const { vao, indexCount } = createVAO(this.gl, this.enemyProgram, vertices, indices, DOOR_VERTEX_STRIDE, ENEMY_LAYOUT);
    this.propVaos.set(key, { vao, indexCount });
  }

  resize(): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    this.updateProjection();
  }

  private updateProjection(): void {
    const aspect = this.canvas.width / this.canvas.height;
    this.projection = perspective((this.fovDegrees * Math.PI) / 180, aspect, 0.1, 200);
  }

  /**
   * 套用設定系統的 FOV（正式 API，見 core/settings.ts SettingsStore.setFov）。
   * 呼叫端負責 clamp 到合法範圍（70～110，PLAN §3.2）；本方法立即重算投影矩陣。
   */
  setFov(fovDegrees: number): void {
    this.fovDegrees = fovDegrees;
    this.updateProjection();
  }

  /** 目前套用的 FOV（度），供設定 UI 顯示同步與驗收讀取（見 window.__p96.debug.getFov）。 */
  getFov(): number {
    return this.fovDegrees;
  }

  render(viewMatrix: Mat4, cameraPos: Vec3, timeSeconds: number): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!this.floorVao || !this.floorTexture || !this.wallVao || !this.wallTexture || !this.ceilingVao) return;

    gl.useProgram(this.program);

    const model = identity();
    gl.uniformMatrix4fv(this.uniformLocations.uModel, false, model);
    gl.uniformMatrix4fv(this.uniformLocations.uView, false, viewMatrix);
    gl.uniformMatrix4fv(this.uniformLocations.uProjection, false, this.projection);

    gl.uniform3f(this.uniformLocations.uLightDir, this.config.lightDir.x, this.config.lightDir.y, this.config.lightDir.z);
    gl.uniform1f(this.uniformLocations.uAmbient, this.config.ambient);
    gl.uniform3f(this.uniformLocations.uAmbientColor, this.config.ambientColor.x, this.config.ambientColor.y, this.config.ambientColor.z);
    gl.uniform3f(this.uniformLocations.uLightColor, this.config.lightColor.x, this.config.lightColor.y, this.config.lightColor.z);
    gl.uniform3f(this.uniformLocations.uCameraPos, cameraPos.x, cameraPos.y, cameraPos.z);
    gl.uniform3f(this.uniformLocations.uFogColor, this.config.fogColor.x, this.config.fogColor.y, this.config.fogColor.z);
    gl.uniform1f(this.uniformLocations.uFogNear, this.config.fogNear);
    gl.uniform1f(this.uniformLocations.uFogFar, this.config.fogFar);
    gl.uniform1f(this.uniformLocations.uTime, timeSeconds);

    gl.uniform1i(this.uniformLocations.uTexture, 0);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform1f(this.uniformLocations.uBrightness, 1.0);

    gl.bindVertexArray(this.floorVao);
    gl.bindTexture(gl.TEXTURE_2D, this.floorTexture);
    gl.drawElements(gl.TRIANGLES, this.floorIndexCount, gl.UNSIGNED_INT, 0);

    gl.bindVertexArray(this.wallVao);
    gl.bindTexture(gl.TEXTURE_2D, this.wallTexture);
    gl.drawElements(gl.TRIANGLES, this.wallIndexCount, gl.UNSIGNED_INT, 0);

    // 天花板：重用 wallTexture（同一張材質，不另開 GL texture），整體壓暗一階，
    // 呼應 Lin 反饋「整體太暗」修正後、補上開放式測試房上方虛空的收尾（不新增材質種子）。
    gl.uniform1f(this.uniformLocations.uBrightness, CEILING_BRIGHTNESS);
    gl.bindVertexArray(this.ceilingVao);
    gl.bindTexture(gl.TEXTURE_2D, this.wallTexture);
    gl.drawElements(gl.TRIANGLES, this.ceilingIndexCount, gl.UNSIGNED_INT, 0);

    gl.bindVertexArray(null);
  }

  /**
   * 繪製敵人實例：依 instance.mesh 查表選取對應 VAO（M3 泛化，支援 crawler／spitter 混合陣列），
   * 只在 mesh key 改變時才重新綁定 VAO（呼叫端一般會先推 crawler 陣列再推 spitter 陣列，
   * 每幀最多切換一次，維持個位數 VAO 綁定）。不清空畫面，接續在 render() 之後呼叫。
   */
  renderEnemies(viewMatrix: Mat4, instances: EnemyInstance[]): void {
    if (instances.length === 0) return;
    const gl = this.gl;

    gl.useProgram(this.enemyProgram);

    gl.uniformMatrix4fv(this.enemyUniformLocations.uView, false, viewMatrix);
    gl.uniformMatrix4fv(this.enemyUniformLocations.uProjection, false, this.projection);
    gl.uniform3f(
      this.enemyUniformLocations.uLightDir,
      this.config.lightDir.x,
      this.config.lightDir.y,
      this.config.lightDir.z,
    );
    gl.uniform1f(this.enemyUniformLocations.uAmbient, this.config.ambient);
    gl.uniform3f(
      this.enemyUniformLocations.uLightColor,
      this.config.lightColor.x,
      this.config.lightColor.y,
      this.config.lightColor.z,
    );
    gl.uniform3f(
      this.enemyUniformLocations.uFogColor,
      this.config.fogColor.x,
      this.config.fogColor.y,
      this.config.fogColor.z,
    );
    gl.uniform3f(this.enemyUniformLocations.uWarningColor, WARNING_COLOR.r, WARNING_COLOR.g, WARNING_COLOR.b);

    let boundKey: string | null = null;
    for (const instance of instances) {
      const entry = this.enemyMeshes.get(instance.mesh);
      if (!entry) continue;
      if (boundKey !== instance.mesh) {
        gl.bindVertexArray(entry.vao);
        boundKey = instance.mesh;
      }
      gl.uniformMatrix4fv(this.enemyUniformLocations.uModel, false, instance.model);
      gl.uniform1f(this.enemyUniformLocations.uDissolve, instance.dissolve);
      gl.uniform1f(this.enemyUniformLocations.uHitFlash, instance.hitFlash);
      gl.uniform1f(this.enemyUniformLocations.uTelegraph, instance.telegraph ?? 0);
      gl.drawElements(gl.TRIANGLES, entry.indexCount, gl.UNSIGNED_INT, 0);
    }

    gl.bindVertexArray(null);
  }

  /**
   * 繪製第一人稱武器 viewmodel：繪製前清空深度緩衝，讓 viewmodel 蓋在整個世界（含敵人）之上；
   * view 固定為單位矩陣（viewmodel 直接以「相機空間」座標定義，不受玩家實際視角影響，
   * 只由 model 矩陣的 recoil 位移小幅偏移），錨定畫面固定位置。
   * weapon（M2 新增，預設 "pistol"）：依目前裝備武器擇一繪製對應幾何。
   */
  renderViewmodel(model: Mat4, weapon: "pistol" | "shotgun" = "pistol"): void {
    const vao = weapon === "shotgun" ? this.shotgunViewmodelVao : this.viewmodelVao;
    const indexCount = weapon === "shotgun" ? this.shotgunViewmodelIndexCount : this.viewmodelIndexCount;
    if (!vao) return;
    const gl = this.gl;

    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.enemyProgram);
    gl.bindVertexArray(vao);

    const identityView = identity();
    gl.uniformMatrix4fv(this.enemyUniformLocations.uView, false, identityView);
    gl.uniformMatrix4fv(this.enemyUniformLocations.uProjection, false, this.projection);
    gl.uniformMatrix4fv(this.enemyUniformLocations.uModel, false, model);
    gl.uniform3f(
      this.enemyUniformLocations.uLightDir,
      this.config.lightDir.x,
      this.config.lightDir.y,
      this.config.lightDir.z,
    );
    // viewmodel 補光：不論場景整體壓暗到多少，手上的槍至少維持 VIEWMODEL_MIN_AMBIENT 可讀。
    gl.uniform1f(this.enemyUniformLocations.uAmbient, Math.max(this.config.ambient, VIEWMODEL_MIN_AMBIENT));
    gl.uniform3f(
      this.enemyUniformLocations.uLightColor,
      this.config.lightColor.x,
      this.config.lightColor.y,
      this.config.lightColor.z,
    );
    gl.uniform3f(
      this.enemyUniformLocations.uFogColor,
      this.config.fogColor.x,
      this.config.fogColor.y,
      this.config.fogColor.z,
    );
    gl.uniform1f(this.enemyUniformLocations.uDissolve, 0);
    gl.uniform1f(this.enemyUniformLocations.uHitFlash, 0);
    gl.uniform1f(this.enemyUniformLocations.uTelegraph, 0);
    gl.uniform3f(this.enemyUniformLocations.uWarningColor, WARNING_COLOR.r, WARNING_COLOR.g, WARNING_COLOR.b);

    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * 繪製一批頂點色 prop 實例（M2 新增：門板、撿取物浮動圖示、武器台座頂飾等），共用
   * enemyProgram／頂點色 pipeline，依 instance.key 查表取用對應 VAO，逐實例只換 uModel。
   * 不清空畫面／深度（接續在世界＋敵人之後、viewmodel 之前繪製）。
   */
  renderProps(viewMatrix: Mat4, instances: { key: string; model: Mat4 }[]): void {
    if (instances.length === 0) return;
    const gl = this.gl;

    gl.useProgram(this.enemyProgram);
    gl.uniformMatrix4fv(this.enemyUniformLocations.uView, false, viewMatrix);
    gl.uniformMatrix4fv(this.enemyUniformLocations.uProjection, false, this.projection);
    gl.uniform3f(this.enemyUniformLocations.uLightDir, this.config.lightDir.x, this.config.lightDir.y, this.config.lightDir.z);
    gl.uniform1f(this.enemyUniformLocations.uAmbient, this.config.ambient);
    gl.uniform3f(this.enemyUniformLocations.uLightColor, this.config.lightColor.x, this.config.lightColor.y, this.config.lightColor.z);
    gl.uniform3f(this.enemyUniformLocations.uFogColor, this.config.fogColor.x, this.config.fogColor.y, this.config.fogColor.z);
    gl.uniform1f(this.enemyUniformLocations.uDissolve, 0);
    gl.uniform1f(this.enemyUniformLocations.uHitFlash, 0);
    gl.uniform1f(this.enemyUniformLocations.uTelegraph, 0);
    gl.uniform3f(this.enemyUniformLocations.uWarningColor, WARNING_COLOR.r, WARNING_COLOR.g, WARNING_COLOR.b);

    for (const instance of instances) {
      const entry = this.propVaos.get(instance.key);
      if (!entry) continue;
      gl.bindVertexArray(entry.vao);
      gl.uniformMatrix4fv(this.enemyUniformLocations.uModel, false, instance.model);
      gl.drawElements(gl.TRIANGLES, entry.indexCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  /**
   * 繪製射擊視覺特效（槍口閃光／彈道 tracer／命中火花）：每次呼叫整批上傳新的動態頂點資料，
   * 依 mode 以對應的 GL primitive 繪製一次。view 傳 identity() 可畫在 viewmodel 空間
   * （如槍口閃光），傳實際世界 view matrix 則畫在世界空間（如 tracer／火花）。
   */
  renderFx(view: Mat4, model: Mat4, vertexData: Float32Array, mode: FxPrimitiveMode): void {
    if (vertexData.length === 0 || !this.fxVao || !this.fxVertexBuffer) return;
    const gl = this.gl;
    const vertexCount = vertexData.length / FX_VERTEX_STRIDE;

    gl.useProgram(this.fxProgram);
    gl.bindVertexArray(this.fxVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fxVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);

    gl.uniformMatrix4fv(this.fxUniformLocations.uModel, false, model);
    gl.uniformMatrix4fv(this.fxUniformLocations.uView, false, view);
    gl.uniformMatrix4fv(this.fxUniformLocations.uProjection, false, this.projection);

    // 啟用 alpha 混合（僅本次繪製，畫完立即關閉，避免影響其餘不透明的 draw call）：
    // 槍口閃光／tracer／火花皆用 alpha 淡出，沒有混合的話 alpha 會被忽略、無法真正淡出。
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // 火花／槍口閃光不寫入深度緩衝：避免同一幀內多次 renderFx 呼叫（如 tracer 與火花）
    // 因深度寫入順序而互相遮蔽；世界幾何／敵人／viewmodel 仍照常寫入深度不受影響。
    gl.depthMask(false);

    const glMode = mode === "LINES" ? gl.LINES : mode === "POINTS" ? gl.POINTS : gl.TRIANGLES;
    gl.drawArrays(glMode, 0, vertexCount);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
