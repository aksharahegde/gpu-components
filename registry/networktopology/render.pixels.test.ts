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
} from "@gpuc/core";
import { ingestTopology } from "./ingest.ts";
import { NetworkTopologyComponent } from "./NetworkTopologyComponent.ts";

/**
 * Real-Dawn verification that the pulsed mesh actually paints pixels — the render-side analogue of
 * `graph`'s `render.pixels.test.ts`. This does not re-check layout stability (covered there and in
 * `topology.test.ts`'s mock-GPU suite); it checks that node/edge draws with kind/status/health/
 * traffic bindings produce visible output on a real device, and that the pulse uniform (`time`)
 * does not stall or NaN the shader across several frames.
 */

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
const VIEWPORT: ViewportState = {
  timeStart: -1.2,
  timeEnd: 1.2,
  trackCount: 1,
  rowStart: -1.2,
  rowEnd: 1.2,
  yContinuous: true,
  width: W,
  height: H,
};

function fixture() {
  return ingestTopology({
    nodes: [
      { label: "region-0", kind: "region", status: "up" },
      { label: "az-0", kind: "az", status: "up" },
      { label: "svc-0", kind: "service", status: "degraded" },
      { label: "svc-1", kind: "service", status: "up" },
      { label: "pod-0", kind: "pod", status: "up" },
      { label: "pod-1", kind: "pod", status: "down" },
    ],
    edges: [
      { source: 0, target: 1, health: 0.9, traffic: 0.6 },
      { source: 1, target: 2, health: 0.6, traffic: 0.8 },
      { source: 1, target: 3, health: 0.95, traffic: 0.4 },
      { source: 2, target: 4, health: 0.5, traffic: 0.9 },
      { source: 3, target: 5, health: 0.1, traffic: 0.7 },
    ],
    seed: 1,
  }).topology;
}

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
    surface: { surface: surfaceTarget, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps: CAPS,
    onDispose: () => {},
  };
}

/** Runs `frames` compute+render loops, advancing `time` each frame like the React wrapper's rAF. */
async function simulate(gpu: Gpu, frames: number) {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new NetworkTopologyComponent();
  component.create(makeCtx(gpu, surfaceTarget));

  let painted = 0;
  let pixels: Uint8Array = new Uint8Array();
  for (let i = 0; i < frames; i++) {
    component.update({ data: fixture(), viewport: VIEWPORT, nodeSizePx: 14, pulseSpeed: 1, time: i * 0.05 });
    const plan = component.plan();
    for (const pass of plan.computePasses) pass.dispatch();
    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });
    await gpu.settled();

    pixels = (await surfaceTarget.read()) as Uint8Array;
    painted = 0;
    for (let p = 0; p < pixels.length; p += 4) {
      if (pixels[p] !== 0 || pixels[p + 1] !== 0 || pixels[p + 2] !== 0) painted++;
    }
  }
  return { pixels, painted, component };
}

describe("GPUNetworkTopology render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("draws nodes and pulsed edges", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { painted, component } = await simulate(gpu, 5);
    assert.ok(painted > 20, `expected a drawn mesh, got ${painted} painted pixels`);
    assert.ok(painted < W * H, "a mesh is not a solid fill");
    component.dispose();
  });

  it("keeps painting across several pulse frames without stalling", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { painted, component } = await simulate(gpu, 20);
    assert.ok(painted > 20, `expected paint to survive advancing time, got ${painted} painted pixels`);
    component.dispose();
  });
});
