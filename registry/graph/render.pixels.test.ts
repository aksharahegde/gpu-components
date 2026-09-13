import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu, type StorageBuffer } from "vgpu";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type Capabilities,
  type ComponentContext,
  type ViewportState,
} from "@gpuc/core";
import { generateClusteredGraph } from "./ingest.ts";
import { GraphComponent } from "./GraphComponent.ts";

/**
 * Real-Dawn verification for the project's first *iterative* GPU workload.
 *
 * The interesting assertions here are not "did anything draw" — every component has that now — but
 * that the simulation is stable: positions stay finite over hundreds of feedback iterations, the
 * ping-pong pair actually alternates, and the layout moves and then stops. An unstable force layout
 * does not crash; it quietly fills its buffer with NaN and renders nothing, which is exactly the
 * class of failure that stayed invisible in this project until pixels were checked.
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

/** Runs `iterations` layout steps, then draws once and reads the surface back. */
async function simulate(gpu: Gpu, iterations: number) {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new GraphComponent();
  component.create(makeCtx(gpu, surfaceTarget));
  component.update({ data: generateClusteredGraph(12, 3).graph, viewport: VIEWPORT, nodeSizePx: 10 });

  for (let i = 0; i < iterations; i++) {
    for (const pass of component.plan().computePasses) pass.dispatch();
  }
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
  return { pixels, painted, component };
}

/** Reads the half of the ping-pong pair the renderer is currently bound to. */
async function readPositions(component: GraphComponent): Promise<Float32Array> {
  const positions = (component as unknown as { positions: { read: StorageBuffer } }).positions;
  const raw = await positions.read.read();
  return new Float32Array(raw.buffer ?? (raw as unknown as ArrayBuffer));
}

describe("GPUGraph render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("draws nodes and edges", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { painted, component } = await simulate(gpu, 1);
    // 36 nodes at 10px plus their edges cover a meaningful area, but nowhere near the full surface.
    assert.ok(painted > 500, `expected a drawn graph, got ${painted} painted pixels`);
    assert.ok(painted < W * H, "a graph is not a solid fill");
    component.dispose();
  });

  it("keeps every position finite across 300 feedback iterations", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // The failure mode this guards: one NaN enters the position buffer, the repulsion loop reads it
    // for every other node on the next iteration, and the whole layout is NaN within two steps —
    // rendering nothing, with no error anywhere.
    const { component } = await simulate(gpu, 300);
    const positions = await readPositions(component);
    for (let i = 0; i < positions.length; i++) {
      assert.ok(Number.isFinite(positions[i]!), `position ${i} became ${positions[i]}`);
      assert.ok(Math.abs(positions[i]!) < 100, `position ${i} escaped to ${positions[i]}`);
    }
    component.dispose();
  });

  it("actually moves the nodes — the simulation does something", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const early = await simulate(gpu, 1);
    const late = await simulate(gpu, 200);
    const a = await readPositions(early.component);
    const b = await readPositions(late.component);

    let moved = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1e-4) moved++;
    assert.ok(moved > a.length / 2, `expected most coordinates to move, ${moved}/${a.length} did`);

    early.component.dispose();
    late.component.dispose();
  });

  it("converges — later iterations move less than earlier ones", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Damping should be draining energy. Without it the layout oscillates forever and `settled`
    // would be a lie told by a counter.
    const at = async (n: number) => readPositions((await simulate(gpu!, n)).component);
    const [p10, p20, p200, p210] = [await at(10), await at(20), await at(200), await at(210)];

    const drift = (x: Float32Array, y: Float32Array) => {
      let total = 0;
      for (let i = 0; i < x.length; i++) total += Math.abs(x[i]! - y[i]!);
      return total;
    };
    const earlyDrift = drift(p10, p20);
    const lateDrift = drift(p200, p210);
    assert.ok(
      lateDrift < earlyDrift,
      `layout should be settling: 10->20 moved ${earlyDrift.toFixed(3)}, 200->210 moved ${lateDrift.toFixed(3)}`,
    );
  });

  it("separates the clusters it was given", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // The point of a force layout: densely-connected groups end up near each other and away from
    // the rest. Compares mean intra-cluster distance against the overall spread.
    const { component } = await simulate(gpu, 400);
    const positions = await readPositions(component);
    const perCluster = 12;

    const centroid = (cluster: number) => {
      let x = 0;
      let y = 0;
      for (let i = 0; i < perCluster; i++) {
        x += positions[(cluster * perCluster + i) * 2]!;
        y += positions[(cluster * perCluster + i) * 2 + 1]!;
      }
      return [x / perCluster, y / perCluster] as const;
    };
    const spread = (cluster: number) => {
      const [cx, cy] = centroid(cluster);
      let total = 0;
      for (let i = 0; i < perCluster; i++) {
        const dx = positions[(cluster * perCluster + i) * 2]! - cx;
        const dy = positions[(cluster * perCluster + i) * 2 + 1]! - cy;
        total += Math.hypot(dx, dy);
      }
      return total / perCluster;
    };

    const centroids = [centroid(0), centroid(1), centroid(2)];
    let betweenTotal = 0;
    let pairs = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        betweenTotal += Math.hypot(centroids[a]![0] - centroids[b]![0], centroids[a]![1] - centroids[b]![1]);
        pairs++;
      }
    }
    const between = betweenTotal / pairs;
    const within = (spread(0) + spread(1) + spread(2)) / 3;
    assert.ok(between > within, `clusters should separate: between ${between.toFixed(3)}, within ${within.toFixed(3)}`);

    component.dispose();
  });
});
