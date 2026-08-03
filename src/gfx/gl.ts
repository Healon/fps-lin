// WebGL2 wrapper：shader 編譯連結（錯誤 throw 含 log）、VAO 與 buffer 建立、texture 上傳。

export function createGL2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) {
    throw new Error("無法取得 WebGL2 context：瀏覽器或裝置不支援 WebGL2。");
  }
  return gl;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("gl.createShader 失敗（回傳 null）。");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;
  if (!ok) {
    const log = gl.getShaderInfoLog(shader) ?? "(無 log)";
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    throw new Error(`Shader 編譯失敗（${kind}）：\n${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  if (!program) throw new Error("gl.createProgram 失敗（回傳 null）。");

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  const ok = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean;
  if (!ok) {
    const log = gl.getProgramInfoLog(program) ?? "(無 log)";
    gl.deleteProgram(program);
    throw new Error(`Shader 連結失敗：\n${log}`);
  }

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return program;
}

export interface AttribLayout {
  name: string;
  size: number; // 幾個 component（如 vec3 = 3）
  offsetFloats: number; // 在 interleaved stride 中的 float 偏移量
}

/**
 * 建立 VAO：綁定一個 interleaved vertex buffer 與 index buffer，依 layout 設定 vertex attrib。
 */
export function createVAO(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  vertices: Float32Array,
  indices: Uint32Array,
  strideFloats: number,
  layout: AttribLayout[],
): { vao: WebGLVertexArrayObject; vertexBuffer: WebGLBuffer; indexBuffer: WebGLBuffer; indexCount: number } {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("gl.createVertexArray 失敗（回傳 null）。");
  gl.bindVertexArray(vao);

  const vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) throw new Error("gl.createBuffer（vertex）失敗（回傳 null）。");
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const strideBytes = strideFloats * 4;
  for (const attr of layout) {
    const location = gl.getAttribLocation(program, attr.name);
    if (location === -1) {
      throw new Error(`找不到 attribute「${attr.name}」，shader 可能未使用它或名稱打錯。`);
    }
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, attr.size, gl.FLOAT, false, strideBytes, attr.offsetFloats * 4);
  }

  const indexBuffer = gl.createBuffer();
  if (!indexBuffer) throw new Error("gl.createBuffer（index）失敗（回傳 null）。");
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  return { vao, vertexBuffer, indexBuffer, indexCount: indices.length };
}

/** 上傳 RGBA Uint8Array 材質，設定基本取樣參數（mipmap＋線性過濾＋repeat wrap）。 */
export function createTexture2D(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  pixels: Uint8Array,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("gl.createTexture 失敗（回傳 null）。");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return texture;
}
