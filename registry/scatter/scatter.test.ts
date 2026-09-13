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
import { computeBounds, ingestColumns, ingestPoints, packPoints, POINT_STRIDE } from "./ingest.ts";
import { buildSpatialIndex, nearestPoint, pointsInRect } from "./spatialIndex.ts";
import { ScatterComponent } from "./ScatterComponent.ts";

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>): ComponentContext {
  return {
    runtime: { caps: NO_WEBGPU_CAPABILITIES, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: { surface: surfaceTarget, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps: NO_WEBGPU_CAPABILITIES,
    onDispose: () => {},
  };
}

/** A deterministic 10x10 lattice on [0,9]^2 — every point's index is predictable from its position. */
const LATTICE = ingestPoints(
  Array.from({ length: 100 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), category: i % 6 })),
);

describe("scatter ingest", () => {
  it("computes bounds over both axes, skipping non-finite points", () => {
    const bounds = computeBounds(
      Float32Array.from([0, 5, Number.NaN, 10]),
      Float32Array.from([0, -2, 3, 8]),
      4,
    );
    assert.deepEqual(bounds, { xMin: 0, xMax: 10, yMin: -2, yMax: 8 });
  });

  it("widens a degenerate axis so the viewport transform never divides by zero", () => {
    const bounds = computeBounds(Float32Array.from([3, 3, 3]), Float32Array.from([1, 2, 3]), 3);
    assert.ok(bounds.xMax > bounds.xMin);
  });

  it("falls back to a unit square when every point is a hole", () => {
    assert.deepEqual(computeBounds(Float32Array.from([Number.NaN]), Float32Array.from([Number.NaN]), 1), {
      xMin: 0,
      xMax: 1,
      yMin: 0,
      yMax: 1,
    });
  });

  it("rejects mismatched columns rather than reading past the end", () => {
    assert.throws(() => ingestColumns(new Float32Array(3), new Float32Array(2)), /same length/);
  });

  it("packs points at the declared stride, positions in data space", () => {
    const bytes = packPoints(ingestPoints([{ x: 1.5, y: -2.5, category: 3 }]));
    assert.equal(bytes.byteLength, POINT_STRIDE);
    const view = new DataView(bytes.buffer);
    assert.equal(view.getFloat32(0, true), 1.5);
    assert.equal(view.getFloat32(4, true), -2.5);
    assert.equal(view.getUint32(8, true), 3);
  });
});

describe("spatial index — the CPU index PLAN.md §9.5 says a dense scatter does not have", () => {
  const index = buildSpatialIndex(LATTICE);

  it("indexes every point exactly once", () => {
    assert.equal(index.items.length, LATTICE.count);
    assert.equal(index.starts[index.starts.length - 1], LATTICE.count);
    const seen = new Set(index.items);
    assert.equal(seen.size, LATTICE.count, "no point may be dropped or duplicated");
  });

  it("finds the exact nearest point, matching a brute-force scan", () => {
    // Brute force is the oracle §23.1 asks for when validating a spatial index.
    const brute = (x: number, y: number, radius: number) => {
      let best: number | null = null;
      let bestDist = radius * radius;
      for (let i = 0; i < LATTICE.count; i++) {
        const dx = LATTICE.x[i]! - x;
        const dy = LATTICE.y[i]! - y;
        const d = dx * dx + dy * dy;
        if (d <= bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    };

    for (const [x, y] of [[0, 0], [4.4, 6.6], [9, 9], [2.5, 2.5], [-0.4, 5.2]] as const) {
      assert.equal(nearestPoint(index, LATTICE, x, y, 1.5), brute(x, y, 1.5), `at ${x},${y}`);
    }
  });

  it("returns null outside the radius rather than the nearest point anywhere", () => {
    assert.equal(nearestPoint(index, LATTICE, 100, 100, 1), null);
    assert.equal(nearestPoint(index, LATTICE, 4.5, 4.5, 0.1), null, "between lattice points");
  });

  it("finds every point in a rectangle, matching a brute-force scan", () => {
    const found = pointsInRect(index, LATTICE, 2, 3, 4, 5).sort((a, b) => a - b);
    const brute: number[] = [];
    for (let i = 0; i < LATTICE.count; i++) {
      if (LATTICE.x[i]! >= 2 && LATTICE.x[i]! <= 4 && LATTICE.y[i]! >= 3 && LATTICE.y[i]! <= 5) brute.push(i);
    }
    assert.deepEqual(found, brute);
    assert.equal(found.length, 9, "a 3x3 block of the lattice");
  });

  it("handles a single-point dataset without collapsing the grid", () => {
    const one = ingestPoints([{ x: 5, y: 5 }]);
    const oneIndex = buildSpatialIndex(one);
    assert.equal(nearestPoint(oneIndex, one, 5, 5, 0.5), 0);
  });
});

describe("ScatterComponent", () => {
  const viewport = {
    timeStart: 0,
    timeEnd: 9,
    trackCount: 10,
    rowStart: 0,
    rowEnd: 9,
    yContinuous: true,
    width: 90,
    height: 90,
  };

  it("runs create/update/plan/dispose against a mock Gpu", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new ScatterComponent(128);
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: LATTICE, viewport });

    const plan = component.plan();
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.computePasses.length, 0, "one instanced draw, no dispatches");

    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("contributes nothing before the first update", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new ScatterComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });

  it("hit-tests screen pixels back to the right point, with y inverted", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new ScatterComponent(128);
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: LATTICE, viewport });

    // 10x10 lattice over 90x90px: 10px per unit. Data (0,0) is bottom-left => pixel (0, 90).
    assert.deepEqual(component.hitTest(0, 90), { id: 0 });
    // Data (9,9) is top-right => pixel (90, 0); that point is index 99.
    assert.deepEqual(component.hitTest(90, 0), { id: 99 });
    // Data (4,4) => pixel (40, 50); index 4*10+4 = 44.
    assert.deepEqual(component.hitTest(40, 50), { id: 44 });

    component.dispose();
    gpu.dispose();
  });

  it("writes a selection bitset without throwing, and ignores out-of-range indices", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new ScatterComponent(128);
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: LATTICE, viewport });

    assert.doesNotThrow(() => component.setSelection([0, 5, 99, -1, 1000]));
    assert.equal(component.dirty, true, "a selection change must mark the component dirty");

    component.dispose();
    gpu.dispose();
  });
});
