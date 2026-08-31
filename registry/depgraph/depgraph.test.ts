import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import { createMockGpu } from "@gpu-components/testing";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type ComponentContext,
  type ViewportState,
} from "@gpu-components/core";
import { DepGraphComponent } from "./DepGraphComponent.ts";
import { ingestDepGraph, NODE_STRIDE, packNodes } from "./ingest.ts";

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>): ComponentContext {
  return {
    runtime: { caps: NO_WEBGPU_CAPABILITIES, invalidate: () => {}, warnings: createWarningsLog() },
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
    caps: NO_WEBGPU_CAPABILITIES,
    onDispose: () => {},
  };
}

const FIXTURE = ingestDepGraph({
  nodes: [
    { id: "app", label: "app", category: 0 },
    { id: "core", label: "core", category: 1 },
    { id: "ui", label: "ui", category: 2 },
    { id: "util", label: "util", category: 1 },
  ],
  edges: [
    { source: 0, target: 1 },
    { source: 0, target: 2 },
    { source: 1, target: 3 },
    { source: 2, target: 3 },
    { source: 3, target: 1 },
  ],
});

function viewportFor(data: typeof FIXTURE, w = 400, h = 300): ViewportState {
  return {
    timeStart: data.bounds.xMin,
    timeEnd: data.bounds.xMax,
    trackCount: 1,
    rowStart: data.bounds.yMin,
    rowEnd: data.bounds.yMax,
    yContinuous: true,
    width: w,
    height: h,
  };
}

describe("depgraph ingest", () => {
  it("rejects empty and out-of-range graphs", () => {
    assert.throws(() => ingestDepGraph({ nodes: [], edges: [] }), /at least one node/);
    assert.throws(
      () => ingestDepGraph({ nodes: [{ id: "a" }], edges: [{ source: 0, target: 1 }] }),
      /out of range/,
    );
  });

  it("runs layout and preserves labels", () => {
    assert.equal(FIXTURE.nodeCount, 4);
    assert.equal(FIXTURE.edgeCount, 5);
    assert.equal(FIXTURE.labels[0], "app");
    assert.ok(FIXTURE.segments.length > 0);
    assert.equal(packNodes(FIXTURE).byteLength, FIXTURE.nodeCount * NODE_STRIDE);
  });
});

describe("DepGraphComponent", () => {
  it("plans edges+nodes with no compute passes", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new DepGraphComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data: FIXTURE, viewport: viewportFor(FIXTURE) });
    const plan = component.plan();
    assert.equal(plan.computePasses.length, 0);
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.renderPasses[0]!.name, "depgraph");
    component.dispose();
  });

  it("hit-tests the nearest laid-out node", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new DepGraphComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    const vp = viewportFor(FIXTURE);
    component.update({ data: FIXTURE, viewport: vp });

    const i = 0;
    const px = ((FIXTURE.x[i]! - vp.timeStart) / (vp.timeEnd - vp.timeStart)) * vp.width;
    const py = ((FIXTURE.y[i]! - (vp.rowStart ?? 0)) / ((vp.rowEnd ?? 1) - (vp.rowStart ?? 0))) * vp.height;
    const hit = component.hitTest(px, py);
    assert.equal(hit?.id, 0);
    component.dispose();
  });

  it("encodes a frame through the mock GPU", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [200, 150] });
    const component = new DepGraphComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data: FIXTURE, viewport: viewportFor(FIXTURE, 200, 150) });
    const plan = component.plan();
    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });
    component.dispose();
  });
});
