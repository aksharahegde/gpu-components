import type { Dataset } from "../types.ts";
import { PALETTE, oscillate, type MountResult, type RendererDef } from "./shared.ts";

const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 aQuad;
layout(location = 1) in float aStart;
layout(location = 2) in float aDuration;
layout(location = 3) in float aTrack;
layout(location = 4) in float aColorIndex;

uniform vec2 uZoomPan;
uniform vec2 uResolution;
uniform float uTrackCount;
uniform vec3 uColors[6];

out vec3 vColor;

void main() {
  float x = (aStart * uZoomPan.x + uZoomPan.y) * uResolution.x;
  float w = max(aDuration * uZoomPan.x * uResolution.x, 0.75);
  float rowH = uResolution.y / uTrackCount;
  float y = aTrack * rowH + 4.0;
  float h = 13.0;
  vec2 pos = vec2(x + aQuad.x * w, y + aQuad.y * h);
  vec2 clip = vec2((pos.x / uResolution.x) * 2.0 - 1.0, 1.0 - (pos.y / uResolution.y) * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = uColors[int(aColorIndex + 0.5)];
}
`;

const FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor, 1.0);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("bench: could not create shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`bench: shader compile failed: ${log}`);
  }
  return shader;
}

/** A minimal, framework-free instanced-quad renderer — the honest WebGL2 comparison PLAN.md §20.3
 * calls for. One uniform update and one `drawArraysInstanced` call per frame; no per-span CPU loop
 * (real GPU instancing does its own clipping via the rasterizer — culling isn't a fair thing to
 * hand-optimize here when the whole point is measuring what the GPU path costs on its own). */
export const webgl2Renderer: RendererDef = {
  id: "webgl2",

  async mount(container: HTMLElement, dataset: Dataset): Promise<MountResult> {
    const t0 = performance.now();
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
    const glOrNull = canvas.getContext("webgl2");
    if (!glOrNull) throw new Error("bench: webgl2 context unavailable");
    const gl: WebGL2RenderingContext = glOrNull;

    const program = gl.createProgram();
    if (!program) throw new Error("bench: could not create program");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`bench: program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);

    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    // clockwise-degenerate-safe two triangles covering the unit quad
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function instanceAttr(location: number, data: Float32Array): WebGLBuffer {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(location, 1);
      return buf;
    }
    const startF32 = Float32Array.from(dataset.start);
    const durF32 = Float32Array.from(dataset.duration);
    const trackF32 = Float32Array.from(dataset.track);
    const colorF32 = Float32Array.from(dataset.colorIndex);
    instanceAttr(1, startF32);
    instanceAttr(2, durF32);
    instanceAttr(3, trackF32);
    instanceAttr(4, colorF32);

    const uZoomPan = gl.getUniformLocation(program, "uZoomPan");
    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uTrackCount = gl.getUniformLocation(program, "uTrackCount");
    const uColors = gl.getUniformLocation(program, "uColors");
    const colors = new Float32Array(6 * 3);
    PALETTE.forEach((hex, i) => colors.set(hexToRgb(hex), i * 3));
    gl.uniform3fv(uColors, colors);
    gl.uniform1f(uTrackCount, dataset.trackCount);

    // Force the GPU to finish uploading before timing stops, matching the WebGPU renderer's
    // `flush()`-then-measure convention — otherwise upload cost is invisible (buffered commands).
    gl.finish();
    const uploadMs = performance.now() - t0;

    return {
      uploadMs,
      handle: {
        frame(now) {
          const { zoom, pan } = oscillate(now);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const W = container.clientWidth;
          const H = container.clientHeight;
          const pw = Math.round(W * dpr);
          const ph = Math.round(H * dpr);
          if (canvas.width !== pw || canvas.height !== ph) {
            canvas.width = pw;
            canvas.height = ph;
          }
          gl.viewport(0, 0, pw, ph);
          gl.clearColor(0x08 / 255, 0x09 / 255, 0x0b / 255, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform2f(uZoomPan, zoom, pan);
          gl.uniform2f(uResolution, W, H);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, dataset.size);
        },
        unmount() {
          canvas.remove();
        },
      },
    };
  },
};
