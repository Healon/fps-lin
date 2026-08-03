// 單一 shader program 的前向渲染器：MVP 變換、貼圖取樣、簡單方向光加環境光、
// 遠處輕微霧化（往 #08090B 淡出）。

import { createGL2Context, createProgram, createVAO, createTexture2D, type AttribLayout } from "./gl.ts";
import { perspective, identity, type Mat4, type Vec3 } from "../core/math.ts";
import { VERTEX_STRIDE } from "../procgen/level/room.ts";

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
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

out vec4 fragColor;

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, -normalize(uLightDir)), 0.0);
  float light = clamp(uAmbient + diffuse * (1.0 - uAmbient), 0.0, 1.0);

  vec4 texColor = texture(uTexture, vUv);
  vec3 lit = texColor.rgb * light;

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

export interface RendererConfig {
  fogColor: Vec3; // 對應 PLAN §5.1 底黑 #08090B
  fogNear: number;
  fogFar: number;
  lightDir: Vec3;
  ambient: number;
}

export const DEFAULT_RENDERER_CONFIG: RendererConfig = {
  fogColor: { x: 0x08 / 255, y: 0x09 / 255, z: 0x0b / 255 },
  fogNear: 8,
  fogFar: 28,
  lightDir: { x: -0.4, y: -1, z: -0.3 },
  ambient: 0.25,
};

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly config: RendererConfig;

  private vao: WebGLVertexArrayObject | null = null;
  private indexCount = 0;
  private texture: WebGLTexture | null = null;
  private projection: Mat4 = identity();

  private readonly uniformLocations: Record<string, WebGLUniformLocation | null>;

  constructor(canvas: HTMLCanvasElement, config: RendererConfig = DEFAULT_RENDERER_CONFIG) {
    this.canvas = canvas;
    this.config = config;
    this.gl = createGL2Context(canvas);
    this.program = createProgram(this.gl, VERTEX_SHADER, FRAGMENT_SHADER);

    const gl = this.gl;
    this.uniformLocations = {
      uModel: gl.getUniformLocation(this.program, "uModel"),
      uView: gl.getUniformLocation(this.program, "uView"),
      uProjection: gl.getUniformLocation(this.program, "uProjection"),
      uTexture: gl.getUniformLocation(this.program, "uTexture"),
      uLightDir: gl.getUniformLocation(this.program, "uLightDir"),
      uAmbient: gl.getUniformLocation(this.program, "uAmbient"),
      uCameraPos: gl.getUniformLocation(this.program, "uCameraPos"),
      uFogColor: gl.getUniformLocation(this.program, "uFogColor"),
      uFogNear: gl.getUniformLocation(this.program, "uFogNear"),
      uFogFar: gl.getUniformLocation(this.program, "uFogFar"),
    };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(this.config.fogColor.x, this.config.fogColor.y, this.config.fogColor.z, 1);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  uploadGeometry(vertices: Float32Array, indices: Uint32Array): void {
    const { vao, indexCount } = createVAO(this.gl, this.program, vertices, indices, VERTEX_STRIDE, LAYOUT);
    this.vao = vao;
    this.indexCount = indexCount;
  }

  uploadTexture(size: number, pixels: Uint8Array): void {
    this.texture = createTexture2D(this.gl, size, size, pixels);
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
    const aspect = width / height;
    this.projection = perspective((90 * Math.PI) / 180, aspect, 0.1, 200);
  }

  render(viewMatrix: Mat4, cameraPos: Vec3): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!this.vao || !this.texture) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniformLocations.uTexture, 0);

    const model = identity();
    gl.uniformMatrix4fv(this.uniformLocations.uModel, false, model);
    gl.uniformMatrix4fv(this.uniformLocations.uView, false, viewMatrix);
    gl.uniformMatrix4fv(this.uniformLocations.uProjection, false, this.projection);

    gl.uniform3f(this.uniformLocations.uLightDir, this.config.lightDir.x, this.config.lightDir.y, this.config.lightDir.z);
    gl.uniform1f(this.uniformLocations.uAmbient, this.config.ambient);
    gl.uniform3f(this.uniformLocations.uCameraPos, cameraPos.x, cameraPos.y, cameraPos.z);
    gl.uniform3f(this.uniformLocations.uFogColor, this.config.fogColor.x, this.config.fogColor.y, this.config.fogColor.z);
    gl.uniform1f(this.uniformLocations.uFogNear, this.config.fogNear);
    gl.uniform1f(this.uniformLocations.uFogFar, this.config.fogFar);

    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    gl.bindVertexArray(null);
  }
}
