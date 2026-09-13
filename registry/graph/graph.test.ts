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
} from "@gpuc/core";
import { generateClusteredGraph, ingestGraph } from "./ingest.ts";
import { GraphComponent } from "./GraphComponent.ts";

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>, caps = NO_WEBGPU_CAPABILITIES): ComponentContext {
  return {
    runtime: { caps, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: { surface: surfaceTarget, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps,
    onDispose: () => {},
  };
}

const VIEWPORT = {
  timeStart: -1,
  timeEnd: 1,
  trackCount: 1,
  rowStart: -1,
  rowEnd: 1,
  yContinuous: true,
  width: 64,
  height: 64,
};

describe("ingestGraph", () => {
  it("builds CSR adjacency where every edge appears from both ends", () => {
    const { graph } = ingestGraph(3, [
      { source: 0, target: 1 },
      { source: 1, target: 2 },
    ]);
    assert.equal(graph.edgeCount, 2);
    assert.equal(graph.adjacencyItems.length, 4, "each edge contributes two directed entries");
    // Node 1 touches both edges, so its slice has two neighbours.
    const from = graph.adjacencyStarts[1]!;
    const to = graph.adjacencyStarts[2]!;
    assert.equal(to - from, 2);
    assert.deepEqual([...graph.adjacencyItems.slice(from, to)].sort(), [0, 2]);
  });

  it("drops out-of-range, negative, fractional and self edges, and counts them", () => {
    // §24.2 applied to a different shape of hostile input: an out-of-range endpoint would pull
    // garbage coordinates into the simulation through the layout kernel.
    const { graph, droppedEdges } = ingestGraph(3, [
      { source: 0, target: 1 },
      { source: 0, target: 9 },
      { source: -1, target: 2 },
      { source: 1.5, target: 2 },
      { source: 2, target: 2 },
    ]);
    assert.equal(graph.edgeCount, 1);
    assert.equal(droppedEdges, 4);
  });

  it("rejects a non-positive node count rather than allocating nothing", () => {
    assert.throws(() => ingestGraph(0, []), /positive integer/);
    assert.throws(() => ingestGraph(-4, []), /positive integer/);
  });

  it("seeds finite, bounded initial positions", () => {
    const { graph } = ingestGraph(64, []);
    for (let i = 0; i < graph.nodeCount * 2; i++) {
      const v = graph.positions[i]!;
      assert.ok(Number.isFinite(v), `position ${i} is ${v}`);
      assert.ok(Math.abs(v) < 1, "seeded inside the unit disc");
    }
  });

  it("is deterministic for a given seed, and different across seeds", () => {
    const a = ingestGraph(32, [], { seed: 7 }).graph.positions;
    const b = ingestGraph(32, [], { seed: 7 }).graph.positions;
    const c = ingestGraph(32, [], { seed: 8 }).graph.positions;
    assert.deepEqual([...a], [...b], "same seed must reproduce exactly — the pixel tests depend on it");
    assert.notDeepEqual([...a], [...c]);
  });

  it("generates a clustered graph with the requested shape", () => {
    const { graph } = generateClusteredGraph(10, 3);
    assert.equal(graph.nodeCount, 30);
    assert.ok(graph.edgeCount > 0);
    assert.equal(graph.category[0], 0);
    assert.equal(graph.category[29], 2);
  });
});

describe("GraphComponent", () => {
  it("runs create/update/plan/dispose against a mock Gpu", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GraphComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: generateClusteredGraph(8, 2).graph, viewport: VIEWPORT });

    const plan = component.plan();
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.computePasses.length, 1, "the layout iteration");

    for (const pass of plan.computePasses) pass.dispatch();
    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("animates — the first component in the project to do so", async () => {
    // No other component sets `animating`, so the scheduler's continuous branch had never run.
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GraphComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: generateClusteredGraph(4, 2).graph, viewport: VIEWPORT });

    assert.equal(component.animating, true);
    assert.equal(component.settled, false);

    component.dispose();
    gpu.dispose();
  });

  it("stops animating once the layout converges, instead of running forever", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GraphComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    const data = generateClusteredGraph(4, 2).graph;
    component.update({ data, viewport: VIEWPORT });

    // Drive it to convergence. §17.3 forbids open-ended work; a graph that animates forever burns
    // a GPU on a background tab.
    for (let i = 0; i < 1000 && component.animating; i++) {
      for (const pass of component.plan().computePasses) pass.dispatch();
    }
    assert.equal(component.animating, false, "must settle");
    assert.equal(component.settled, true);
    assert.equal(component.plan().computePasses.length, 0, "a settled layout contributes no work");

    component.dispose();
    gpu.dispose();
  });

  it("honours `paused` without discarding progress", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GraphComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    const data = generateClusteredGraph(4, 2).graph;

    component.update({ data, viewport: VIEWPORT });
    for (const pass of component.plan().computePasses) pass.dispatch();
    const progressed = component.iterationCount;

    component.update({ data, viewport: VIEWPORT, paused: true });
    assert.equal(component.animating, false);
    assert.equal(component.plan().computePasses.length, 0);

    component.update({ data, viewport: VIEWPORT, paused: false });
    assert.equal(component.animating, true, "resumes");
    assert.equal(component.iterationCount, progressed, "and keeps the iterations it already ran");

    component.dispose();
    gpu.dispose();
  });

  it("restarts the simulation when the data changes", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GraphComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    component.update({ data: generateClusteredGraph(4, 2).graph, viewport: VIEWPORT });
    for (const pass of component.plan().computePasses) pass.dispatch();
    assert.ok(component.iterationCount > 0);

    component.update({ data: generateClusteredGraph(5, 2).graph, viewport: VIEWPORT });
    assert.equal(component.iterationCount, 0, "a new graph is a new layout");
    assert.equal(component.animating, true);

    component.dispose();
    gpu.dispose();
  });

  it("contributes nothing before the first update", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GraphComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });

  it("declines to hit-test, because its positions never reach the CPU", async () => {
    // The finding, asserted: GPUScatter's spatial index works because its coordinates are static
    // and CPU-side. A graph's move every iteration and live only on the GPU, so this is the case
    // §9.5 reserves async GPU picking for — and core's Picker does not exist yet.
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GraphComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: generateClusteredGraph(4, 2).graph, viewport: VIEWPORT });
    assert.equal(component.hitTest(), null);
    component.dispose();
    gpu.dispose();
  });

  it("warns above the node count its O(n^2) repulsion is meant for", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const ctx = { ...makeCtx(gpu, surfaceTarget), caps };
    const component = new GraphComponent();
    component.create(ctx);
    // 6000 nodes, no edges — cheap to build, over the documented ceiling.
    component.update({ data: ingestGraph(6000, []).graph, viewport: VIEWPORT });

    const warning = ctx.runtime.warnings.recent.find((w) => w.code === "graph-size");
    assert.ok(warning, "should say so rather than quietly bogging down");
    assert.match(warning!.message, /6,000 nodes/);

    component.dispose();
    gpu.dispose();
  });
});
