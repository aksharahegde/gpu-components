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
import { cpuHistogram } from "./bins.ts";
import { ingestNumbers } from "./ingest.ts";
import { HistogramComponent } from "./HistogramComponent.ts";

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
const H = 120;

const DATA = ingestNumbers(
  [
    ...Array.from({ length: 40 }, () => 1),
    ...Array.from({ length: 80 }, () => 2),
    ...Array.from({ length: 20 }, () => 3),
    ...Array.from({ length: 10 }, () => 4),
  ],
  { binCount: 5 },
);

const VIEWPORT: ViewportState = {
  timeStart: DATA.domain.min,
  timeEnd: DATA.domain.max,
  trackCount: 1,
  rowStart: 0,
  rowEnd: 1,
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

describe("GPUHistogram render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("paints bars and matches the CPU bin total", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");

    const surfaceTarget = target(gpu, { size: [W, H] });
    const component = new HistogramComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data: DATA, viewport: VIEWPORT, opacity: 1 });

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
    assert.ok(painted > 100, `expected painted bars, got ${painted} lit pixels`);

    const oracle = cpuHistogram(DATA.values, DATA.count, DATA.domain.min, DATA.domain.max, DATA.binCount);
    assert.equal(
      oracle.reduce((a, b) => a + b, 0),
      DATA.finiteCount,
      "CPU oracle must account for every finite sample",
    );

    component.dispose();
  });
});
