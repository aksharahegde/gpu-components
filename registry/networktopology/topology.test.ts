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
} from "@gpu-components/core";
import { ingestTopology, KIND, STATUS } from "./ingest.ts";
import { NetworkTopologyComponent } from "./NetworkTopologyComponent.ts";

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

describe("ingestTopology", () => {
  it("builds CSR and packs kind/status/health/traffic", () => {
    const { topology, droppedEdges } = ingestTopology({
      nodes: [
        { label: "r0", kind: "region", status: "up" },
        { label: "svc", kind: "service", status: "degraded" },
        { label: "pod", kind: "pod", status: "down" },
      ],
      edges: [{ source: 0, target: 1, health: 0.9, traffic: 0.5 }],
      seed: 1,
    });
    assert.equal(droppedEdges, 0);
    assert.equal(topology.nodeCount, 3);
    assert.equal(topology.edgeCount, 1);
    assert.equal(topology.kind[0], KIND.region);
    assert.equal(topology.status[1], STATUS.degraded);
    assert.equal(topology.status[2], STATUS.down);
    assert.ok(Math.abs(topology.edgeHealth[0]! - 0.9) < 1e-6);
    assert.ok(Math.abs(topology.edgeTraffic[0]! - 0.5) < 1e-6);
    assert.equal(topology.adjacencyItems.length, 2);
    assert.equal(topology.labels?.[1], "svc");
  });

  it("clamps health/traffic and drops bad endpoints", () => {
    const { topology, droppedEdges } = ingestTopology({
      nodes: [
        { kind: "host", status: "up" },
        { kind: "host", status: "up" },
      ],
      edges: [
        { source: 0, target: 1, health: 2, traffic: -1 },
        { source: 0, target: 9, health: 1, traffic: 1 },
        { source: 1, target: 1, health: 1, traffic: 1 },
      ],
    });
    assert.equal(topology.edgeCount, 1);
    assert.equal(droppedEdges, 2);
    assert.equal(topology.edgeHealth[0], 1);
    assert.equal(topology.edgeTraffic[0], 0);
  });

  it("rejects empty node lists", () => {
    assert.throws(() => ingestTopology({ nodes: [], edges: [] }), /at least one node/);
  });

  it("is deterministic for a given seed", () => {
    const a = ingestTopology({
      nodes: [{ kind: "pod", status: "up" }, { kind: "pod", status: "up" }],
      edges: [{ source: 0, target: 1, health: 1, traffic: 1 }],
      seed: 7,
    }).topology.positions;
    const b = ingestTopology({
      nodes: [{ kind: "pod", status: "up" }, { kind: "pod", status: "up" }],
      edges: [{ source: 0, target: 1, health: 1, traffic: 1 }],
      seed: 7,
    }).topology.positions;
    assert.deepEqual([...a], [...b]);
  });
});

describe("NetworkTopologyComponent", () => {
  it("plans layout compute while animating and draws edges then nodes", async () => {
    const { topology } = ingestTopology({
      nodes: [
        { kind: "service", status: "up" },
        { kind: "pod", status: "up" },
      ],
      edges: [{ source: 0, target: 1, health: 1, traffic: 0.8 }],
      seed: 1,
    });
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const component = new NetworkTopologyComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({
      data: topology,
      viewport: VIEWPORT,
      time: 0.25,
      pulseSpeed: 1,
    });

    assert.equal(component.animating, true);
    const plan = component.plan();
    assert.ok(plan.computePasses.some((p) => p.name === "networktopology-layout"));
    assert.equal(plan.renderPasses[0]?.name, "networktopology");
    assert.equal(component.hitTest(), null);

    for (const pass of plan.computePasses) pass.dispatch();
    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("stops animating when paused, but keeps its render pass", async () => {
    const { topology } = ingestTopology({
      nodes: [
        { kind: "service", status: "up" },
        { kind: "pod", status: "up" },
      ],
      edges: [{ source: 0, target: 1, health: 1, traffic: 0.8 }],
      seed: 1,
    });
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const component = new NetworkTopologyComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    component.update({ data: topology, viewport: VIEWPORT, paused: true });
    assert.equal(component.animating, false);
    const plan = component.plan();
    assert.equal(plan.computePasses.length, 0);
    assert.equal(plan.renderPasses[0]?.name, "networktopology");

    component.dispose();
    gpu.dispose();
  });

  it("keeps animating for pulse/time updates after layout settles, but stops layout compute", async () => {
    const { topology } = ingestTopology({
      nodes: [
        { kind: "service", status: "up" },
        { kind: "pod", status: "up" },
      ],
      edges: [{ source: 0, target: 1, health: 1, traffic: 0.8 }],
      seed: 1,
    });
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const component = new NetworkTopologyComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: topology, viewport: VIEWPORT, time: 0, pulseSpeed: 1 });

    // Drive the layout to convergence. §17.3 forbids open-ended compute work, but the pulse still
    // needs scheduler ticks after that to move — it is driven by `time`, not by iteration count.
    for (let i = 0; i < 700; i++) {
      const plan = component.plan();
      for (const pass of plan.computePasses) pass.dispatch();
    }

    const settledPlan = component.plan();
    assert.equal(settledPlan.computePasses.length, 0, "a settled layout contributes no compute work");
    assert.equal(component.animating, true, "pulse/time still needs frames after layout settles");

    component.dispose();
    gpu.dispose();
  });

  it("restarts the simulation when the data changes", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const component = new NetworkTopologyComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    const first = ingestTopology({
      nodes: [
        { kind: "service", status: "up" },
        { kind: "pod", status: "up" },
      ],
      edges: [{ source: 0, target: 1, health: 1, traffic: 0.8 }],
      seed: 1,
    }).topology;
    component.update({ data: first, viewport: VIEWPORT });
    for (const pass of component.plan().computePasses) pass.dispatch();
    assert.ok(component.iterationCount > 0);

    const second = ingestTopology({
      nodes: [
        { kind: "service", status: "up" },
        { kind: "pod", status: "up" },
        { kind: "host", status: "up" },
      ],
      edges: [{ source: 0, target: 1, health: 1, traffic: 0.8 }],
      seed: 1,
    }).topology;
    component.update({ data: second, viewport: VIEWPORT });
    assert.equal(component.iterationCount, 0, "new topology data is a new layout");
    assert.equal(component.animating, true);

    component.dispose();
    gpu.dispose();
  });

  it("contributes nothing before the first update", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const component = new NetworkTopologyComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });

  it("warns above the node count its O(n^2) repulsion is meant for", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const ctx = { ...makeCtx(gpu, surfaceTarget), caps };
    const component = new NetworkTopologyComponent();
    component.create(ctx);

    const nodes = Array.from({ length: 6000 }, () => ({ kind: "host" as const, status: "up" as const }));
    const { topology } = ingestTopology({ nodes, edges: [] });
    component.update({ data: topology, viewport: VIEWPORT });

    const warning = ctx.runtime.warnings.recent.find((w) => w.code === "networktopology-size");
    assert.ok(warning, "should say so rather than quietly bogging down");
    assert.match(warning!.message, /6,000 nodes/);

    component.dispose();
    gpu.dispose();
  });
});
