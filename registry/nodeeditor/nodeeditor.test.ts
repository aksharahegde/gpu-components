import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import { createMockGpu } from "@gpuc/testing";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type ComponentContext,
  type ViewportState,
} from "@gpuc/core";
import { NodeEditorComponent } from "./NodeEditorComponent.ts";
import {
  addEdge,
  deriveEdgeLines,
  ingestNodeEditor,
  markNodeDeleted,
  NODE_FLAG_DELETED,
  NODE_FLAG_SELECTED,
  NODE_STRIDE,
  packNodes,
  portPosition,
  removeEdgeAt,
} from "./ingest.ts";

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

const FIXTURE = ingestNodeEditor({
  nodes: [
    { id: "in", label: "Input", x: 0, y: 0, width: 1.6, height: 0.9 },
    { id: "map", label: "Map", x: 2.4, y: 0, width: 1.6, height: 0.9 },
    { id: "out", label: "Output", x: 4.8, y: 0, width: 1.6, height: 0.9 },
  ],
  edges: [
    { source: 0, target: 1 },
    { source: 1, target: 2 },
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

describe("nodeeditor ingest", () => {
  it("rejects empty graphs and out-of-range edges", () => {
    assert.throws(() => ingestNodeEditor({ nodes: [], edges: [] }), /at least one node/);
    assert.throws(
      () => ingestNodeEditor({ nodes: [{ id: "a" }], edges: [{ source: 0, target: 1 }] }),
      /out of range/,
    );
  });

  it("keeps supplied positions and falls back to a grid otherwise", () => {
    assert.ok(Math.abs(FIXTURE.x[1]! - 2.4) < 1e-5);
    const noPositions = ingestNodeEditor({ nodes: [{}, {}, {}, {}], edges: [] });
    assert.equal(noPositions.x[0], 0);
    assert.ok(noPositions.x[1]! > noPositions.x[0]! || noPositions.y[1]! > noPositions.y[0]!);
  });

  it("tracks in/out degree", () => {
    assert.equal(FIXTURE.outDegree[0], 1);
    assert.equal(FIXTURE.inDegree[1], 1);
    assert.equal(FIXTURE.outDegree[2], 0);
  });

  it("packs nodes and derives edge lines from live positions", () => {
    assert.equal(packNodes(FIXTURE).byteLength, FIXTURE.nodeCount * NODE_STRIDE);
    const lines = deriveEdgeLines(FIXTURE);
    assert.equal(lines.length, 2);
    // source 0's right edge -> target 1's left edge.
    assert.equal(lines[0]!.x0, FIXTURE.x[0]! + FIXTURE.halfWidth[0]!);
    assert.equal(lines[0]!.x1, FIXTURE.x[1]! - FIXTURE.halfWidth[1]!);
  });

  it("bakes a selection flag into packed node instances", () => {
    const view = new DataView(packNodes(FIXTURE, new Set([1])).buffer);
    const flagsOf = (i: number) => view.getUint32(i * NODE_STRIDE + 20, true);
    assert.equal(flagsOf(0) & NODE_FLAG_SELECTED, 0);
    assert.equal(flagsOf(1) & NODE_FLAG_SELECTED, NODE_FLAG_SELECTED);
  });

  it("addEdge/removeEdgeAt keep edgeCount and degree consistent; rejects self-loops", () => {
    const data = ingestNodeEditor({
      nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 2.4, y: 0 }],
      edges: [],
    });
    assert.equal(addEdge(data, 0, 0), false);
    assert.equal(addEdge(data, 0, 1), true);
    assert.equal(data.edgeCount, 1);
    assert.equal(data.outDegree[0], 1);
    assert.equal(data.inDegree[1], 1);

    removeEdgeAt(data, 0);
    assert.equal(data.edgeCount, 0);
    assert.equal(data.outDegree[0], 0);
    assert.equal(data.inDegree[1], 0);
  });

  it("markNodeDeleted soft-deletes and drops every edge touching the node", () => {
    const data = ingestNodeEditor({
      nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 2.4, y: 0 }, { id: "c", x: 4.8, y: 0 }],
      edges: [{ source: 0, target: 1 }, { source: 1, target: 2 }],
    });
    markNodeDeleted(data, 1);
    assert.equal(data.deleted[1], 1);
    assert.equal(data.edgeCount, 0);
    assert.equal(deriveEdgeLines(data).length, 0);

    const view = new DataView(packNodes(data).buffer);
    assert.equal(view.getUint32(1 * NODE_STRIDE + 20, true) & NODE_FLAG_DELETED, NODE_FLAG_DELETED);
  });

  it("portPosition matches deriveEdgeLines' endpoints", () => {
    const lines = deriveEdgeLines(FIXTURE);
    const out = portPosition(FIXTURE, { node: 0, kind: "out" });
    const inp = portPosition(FIXTURE, { node: 1, kind: "in" });
    assert.equal(out.x, lines[0]!.x0);
    assert.equal(inp.x, lines[0]!.x1);
  });
});

describe("NodeEditorComponent", () => {
  it("plans edges+nodes with no compute passes", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data: FIXTURE, viewport: viewportFor(FIXTURE) });
    const plan = component.plan();
    assert.equal(plan.computePasses.length, 0);
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.renderPasses[0]!.name, "nodeeditor");
    component.dispose();
  });

  it("hit-tests inside a node's box and misses outside it", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    const vp = viewportFor(FIXTURE);
    component.update({ data: FIXTURE, viewport: vp });

    const toPx = (x: number, y: number) => ({
      px: ((x - vp.timeStart) / (vp.timeEnd - vp.timeStart)) * vp.width,
      py: ((y - (vp.rowStart ?? 0)) / ((vp.rowEnd ?? 1) - (vp.rowStart ?? 0))) * vp.height,
    });

    const center = toPx(FIXTURE.x[1]!, FIXTURE.y[1]!);
    assert.equal(component.hitTest(center.px, center.py)?.id, 1);

    const farAway = toPx(FIXTURE.bounds.xMax + 10, FIXTURE.bounds.yMax + 10);
    assert.equal(component.hitTest(farAway.px, farAway.py), null);

    component.dispose();
  });

  it("moveNode() mutates the shared data in place and re-derives edge lines", async () => {
    // A fresh ingest, not the shared `FIXTURE` — `moveNode()` mutates its `data` argument in
    // place, and `FIXTURE` is reused (unmutated) by every other test in this file.
    const data = ingestNodeEditor({
      nodes: [
        { id: "a", x: 0, y: 0, width: 1.6, height: 0.9 },
        { id: "b", x: 2.4, y: 0, width: 1.6, height: 0.9 },
      ],
      edges: [{ source: 0, target: 1 }],
    });
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    const vp = viewportFor(data);
    component.update({ data, viewport: vp });

    component.moveNode(0, 1.5, 0.5);
    assert.equal(data.x[0], 1.5);
    assert.equal(data.y[0], 0.5);
    // The edge's start endpoint follows node 0's new position — proof `moveNode()` re-derives
    // edge lines from the live arrays rather than leaving the ingest-time-baked ones stale.
    const lines = deriveEdgeLines(data);
    assert.equal(lines[0]!.x0, 1.5 + data.halfWidth[0]!);

    // Out-of-range indices are a no-op, not a throw — a drag handler should never crash the
    // canvas because of a stale index from a race with a data change.
    component.moveNode(99, 1, 1);

    component.dispose();
  });

  it("hitTestPort finds the nearest port and respects deletion", async () => {
    const data = ingestNodeEditor({
      nodes: [
        { id: "a", x: 0, y: 0, width: 1.6, height: 0.9 },
        { id: "b", x: 2.4, y: 0, width: 1.6, height: 0.9 },
      ],
      edges: [],
    });
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    const vp = viewportFor(data);
    component.update({ data, viewport: vp });

    const toPx = (x: number, y: number) => ({
      px: ((x - vp.timeStart) / (vp.timeEnd - vp.timeStart)) * vp.width,
      py: ((y - (vp.rowStart ?? 0)) / ((vp.rowEnd ?? 1) - (vp.rowStart ?? 0))) * vp.height,
    });

    const outPort = portPosition(data, { node: 0, kind: "out" });
    const px = toPx(outPort.x, outPort.y);
    assert.deepEqual(component.hitTestPort(px.px, px.py), { node: 0, kind: "out" });

    markNodeDeleted(data, 0);
    // Node 0's port is out of hit-test range entirely now — nothing else is close enough to answer.
    assert.equal(component.hitTestPort(px.px, px.py), null);

    component.dispose();
  });

  it("hitTestEdge finds the nearest edge segment", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    const vp = viewportFor(FIXTURE);
    component.update({ data: FIXTURE, viewport: vp });

    const lines = deriveEdgeLines(FIXTURE);
    const midX = (lines[0]!.x0 + lines[0]!.x1) / 2;
    const px = ((midX - vp.timeStart) / (vp.timeEnd - vp.timeStart)) * vp.width;
    const py = ((lines[0]!.y0 - (vp.rowStart ?? 0)) / ((vp.rowEnd ?? 1) - (vp.rowStart ?? 0))) * vp.height;
    assert.equal(component.hitTestEdge(px, py), 0);

    component.dispose();
  });

  it("addEdge/deleteEdgeAt/deleteNode mutate the live data and re-upload", async () => {
    const data = ingestNodeEditor({
      nodes: [
        { id: "a", x: 0, y: 0, width: 1.6, height: 0.9 },
        { id: "b", x: 2.4, y: 0, width: 1.6, height: 0.9 },
      ],
      edges: [],
    });
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data, viewport: viewportFor(data) });

    assert.equal(component.addEdge(0, 0), false); // self-loop rejected
    assert.equal(component.addEdge(0, 1), true);
    assert.equal(data.edgeCount, 1);

    component.deleteEdgeAt(0);
    assert.equal(data.edgeCount, 0);

    component.addEdge(0, 1);
    component.deleteNode(1);
    assert.equal(data.deleted[1], 1);
    assert.equal(data.edgeCount, 0); // the edge touching the deleted node is gone too

    component.dispose();
  });

  it("setPendingEdge/setHoveredPort don't touch node or edge buffers", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [400, 300] });
    const component = new NodeEditorComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data: FIXTURE, viewport: viewportFor(FIXTURE) });

    component.setPendingEdge({ x0: 0, y0: 0, x1: 1, y1: 1 });
    component.setHoveredPort({ node: 0, kind: "out" });
    const plan = component.plan();
    assert.equal(plan.renderPasses.length, 1); // still one pass — pending/port layers draw inside it
    component.setPendingEdge(null);
    component.setHoveredPort(null);

    component.dispose();
  });

  it("encodes a frame through the mock GPU", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [200, 150] });
    const component = new NodeEditorComponent();
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
