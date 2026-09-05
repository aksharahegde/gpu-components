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
import { NodeEditorComponent } from "./NodeEditorComponent.ts";
import { ingestNodeEditor } from "./ingest.ts";

const CAPS: Capabilities = {
  ...NO_WEBGPU_CAPABILITIES,
  webgpu: true,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  tier: "gpu",
};

const W = 220;
const H = 160;

const DATA = ingestNodeEditor({
  nodes: Array.from({ length: 6 }, (_, i) => ({
    id: `n${i}`,
    label: `node-${i}`,
    x: (i % 3) * 2.4,
    y: Math.floor(i / 3) * 1.6,
    width: 1.6,
    height: 0.9,
    category: i % 3,
  })),
  edges: [
    { source: 0, target: 1 },
    { source: 1, target: 2 },
    { source: 3, target: 4 },
    { source: 4, target: 5 },
  ],
});

const VIEWPORT: ViewportState = {
  timeStart: DATA.bounds.xMin,
  timeEnd: DATA.bounds.xMax,
  trackCount: 1,
  rowStart: DATA.bounds.yMin,
  rowEnd: DATA.bounds.yMax,
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

describe("GPUNodeEditor render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("paints node boxes and connecting edges", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");

    const surfaceTarget = target(gpu, { size: [W, H] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data: DATA, viewport: VIEWPORT, opacity: 1 });

    const plan = component.plan();
    assert.equal(plan.computePasses.length, 0);

    frame(gpu, (f) => {
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
    assert.ok(painted > 40, `expected painted nodes, got ${painted} lit pixels`);

    component.dispose();
  });

  it("paints ports, a selection highlight, and a pending-connect preview line", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");

    const surfaceTarget = target(gpu, { size: [W, H] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data: DATA, viewport: VIEWPORT, selectedNodes: new Set([0]) });
    component.setPendingEdge({ x0: DATA.x[2]!, y0: DATA.y[2]!, x1: DATA.x[5]!, y1: DATA.y[5]! });
    component.setHoveredPort({ node: 1, kind: "in" });

    const plan = component.plan();
    frame(gpu, (f) => {
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
    assert.ok(painted > 40, `expected painted nodes/ports/pending edge, got ${painted} lit pixels`);

    component.dispose();
  });
});
