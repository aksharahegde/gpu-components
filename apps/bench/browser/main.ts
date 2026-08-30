import { generateDataset } from "../src/generators.ts";
import { domRenderer } from "../src/renderers/dom.ts";
import { canvas2dRenderer } from "../src/renderers/canvas2d.ts";
import { webgl2Renderer } from "../src/renderers/webgl2.ts";
import { webgpuRenderer } from "../src/renderers/webgpu.ts";
import type { RendererDef } from "../src/renderers/shared.ts";
import { DEFAULT_OPTIONS, measureRenderer, type RunOptions } from "../src/harness/runner.ts";
import { runSharedContextScenario } from "../src/harness/sharedContextScenario.ts";
import type { RendererId } from "../src/types.ts";
// `Window.__bench`'s type comes from the ambient `./global.d.ts` in this directory — picked up
// automatically by `include` in tsconfig.json, no import needed (and importing a `.d.ts` as a
// value module would confuse Vite's dev-server transform).

const renderers: Record<RendererId, RendererDef> = {
  dom: domRenderer,
  canvas2d: canvas2dRenderer,
  webgl2: webgl2Renderer,
  webgpu: webgpuRenderer,
};

const stage = document.getElementById("stage");
if (!stage) throw new Error("bench: #stage missing");

window.__bench = {
  async runCell(renderer, shape, size, opts) {
    stage.innerHTML = "";
    const dataset = generateDataset(shape, size);
    const merged: RunOptions = { ...DEFAULT_OPTIONS, ...(opts ?? {}) };
    return measureRenderer(renderers[renderer], stage, dataset, merged);
  },
  async runSharedContext() {
    stage.innerHTML = "";
    return runSharedContextScenario(stage);
  },
};
