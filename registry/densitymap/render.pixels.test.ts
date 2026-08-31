import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type Capabilities,
  type ComponentContext,
  type ViewportState,
} from "@gpu-components/core";
import { ingestPoints } from "./ingest.ts";
import { DensityMapComponent } from "./DensityMapComponent.ts";

const CAPS: Capabilities = {
  ...NO_WEBGPU_CAPABILITIES,
  webgpu: true,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  tier: "gpu",
};

const W = 200;
const H = 200;

const DATA = ingestPoints([
  { lon: 0, lat: 0 },
  { lon: 0.2, lat: 0.1 },
  { lon: -0.15, lat: 0.05 },
  { lon: 0.05, lat: -0.1 },
  { lon: -0.05, lat: -0.05 },
]);

const VIEWPORT: ViewportState = {
  timeStart: DATA.bounds.xMin - 50_000,
  timeEnd: DATA.bounds.xMax + 50_000,
  trackCount: 1,
  rowStart: DATA.bounds.yMin - 50_000,
  rowEnd: DATA.bounds.yMax + 50_000,
  yContinuous: true,
  width: W,
  height: H,
};

async function initDawn(): Promise<Gpu | null> {
  try {
    const { init } = await import("vgpu/node");
    return await init();
  } catch {
    return null;
  }
}

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>): ComponentContext {
  return {
    runtime: { caps: CAPS, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: {
      surface: surfaceTarget,
      get dirty() {
        return true;
      },
      clearDirty: () => {},
      markDirty: () => {},
    },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps: CAPS,
    onDispose: () => {},
  };
}

async function render(gpu: Gpu): Promise<{ pixels: Uint8Array; painted: number }> {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new DensityMapComponent();
  component.create(makeCtx(gpu, surfaceTarget));
  component.update({ data: DATA, viewport: VIEWPORT, hexSizePx: 20, opacity: 1 });

  const plan = component.plan();
  frame(gpu, (f) => {
    for (const pass of plan.computePasses) pass.dispatch();
    f.pass({ target: surfaceTarget, clear: true }, (fp) => {
      for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
    });
  });
  await gpu.settled();

  const pixels = (await surfaceTarget.read()) as Uint8Array;
  let painted = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) painted++;
  }
  component.dispose();
  return { pixels, painted };
}

describe("GPUDensityMap render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("paints hex density for a known lon/lat cluster", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { painted } = await render(gpu);
    assert.ok(painted > 50, `expected hex fill, got ${painted} lit pixels`);
  });
});
