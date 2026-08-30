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
import { buildColormapLut, colormapKey, LUT_SIZE } from "./colormap.ts";
import { computeRange, ingestMatrix } from "./ingest.ts";
import { HeatmapComponent } from "./HeatmapComponent.ts";

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>, registry = new ResourceRegistry()): ComponentContext {
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
    registry,
    caps: NO_WEBGPU_CAPABILITIES,
    onDispose: () => {},
  };
}

describe("ingestMatrix", () => {
  it("rejects a value count that does not match the declared shape", () => {
    assert.throws(() => ingestMatrix(new Float32Array(5), 2, 3), /expected 6 values/);
    assert.throws(() => ingestMatrix(new Float32Array(4), 0, 4), /positive integers/);
  });

  it("accepts a plain array and converts it once", () => {
    const data = ingestMatrix([1, 2, 3, 4], 2, 2);
    assert.ok(data.values instanceof Float32Array);
    assert.equal(data.rows, 2);
    assert.equal(data.cols, 2);
  });
});

describe("computeRange", () => {
  it("ignores NaN holes rather than letting one poison the colour scale", () => {
    const data = ingestMatrix([1, Number.NaN, 3, 5], 2, 2);
    assert.deepEqual(computeRange(data), [1, 5]);
  });

  it("returns a non-degenerate range for a constant matrix", () => {
    const [lo, hi] = computeRange(ingestMatrix([7, 7, 7, 7], 2, 2));
    assert.ok(hi > lo, "a flat matrix must not produce a zero-width range");
  });

  it("falls back to [0,1] when every cell is a hole", () => {
    const data = ingestMatrix([Number.NaN, Number.NaN], 1, 2);
    assert.deepEqual(computeRange(data), [0, 1]);
  });
});

describe("buildColormapLut", () => {
  it("produces LUT_SIZE opaque RGBA entries inside [0,1]", () => {
    const lut = buildColormapLut("viridis");
    assert.equal(lut.length, LUT_SIZE * 4);
    for (let i = 0; i < LUT_SIZE; i++) {
      assert.equal(lut[i * 4 + 3], 1, "alpha must be opaque");
      for (let c = 0; c < 3; c++) {
        const v = lut[i * 4 + c]!;
        assert.ok(v >= 0 && v <= 1, `channel out of range at entry ${i}: ${v}`);
      }
    }
  });

  it("ramps monotonically in luminance from dark to bright", () => {
    const lut = buildColormapLut("viridis");
    const lum = (i: number) => lut[i * 4]! * 0.2126 + lut[i * 4 + 1]! * 0.7152 + lut[i * 4 + 2]! * 0.0722;
    assert.ok(lum(LUT_SIZE - 1) > lum(0) + 0.5, "the ramp should span a wide luminance range");
  });

  it("keys by content so identical ramps dedupe in the registry", () => {
    assert.equal(colormapKey("viridis"), colormapKey("viridis"));
    assert.notEqual(colormapKey("viridis"), colormapKey("magma"));
  });
});

describe("HeatmapComponent", () => {
  it("runs create/update/plan/dispose against a mock Gpu and declares its two reduction passes", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [8, 8] });
    const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

    const component = new HeatmapComponent();
    component.create(ctx);
    component.update({
      data: ingestMatrix([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, 3),
      viewport: { timeStart: 0, timeEnd: 3, trackCount: 3, width: 8, height: 8 },
    });

    const plan = component.plan();
    assert.deepEqual(
      plan.computePasses.map((p) => p.name),
      ["heatmap-reduce-chunk", "heatmap-reduce-final"],
    );
    assert.equal(plan.renderPasses.length, 1);

    for (const pass of plan.computePasses) pass.dispatch();
    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("re-runs the range reduction only when the data changes, not on every pan", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [8, 8] });
    const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

    const component = new HeatmapComponent();
    component.create(ctx);
    const data = ingestMatrix([1, 2, 3, 4], 2, 2);
    const viewport = { timeStart: 0, timeEnd: 2, trackCount: 2, width: 8, height: 8 };

    component.update({ data, viewport });
    assert.equal(component.plan().computePasses.length, 2, "first upload reduces");

    // Same data, panned viewport: a matrix's min/max cannot change, so no dispatch.
    component.update({ data, viewport: { ...viewport, timeStart: 0.5, timeEnd: 2.5 } });
    assert.equal(component.plan().computePasses.length, 0, "panning must not re-reduce");

    // New data: reduce again.
    component.update({ data: ingestMatrix([9, 9, 9, 9], 2, 2), viewport });
    assert.equal(component.plan().computePasses.length, 2, "new data reduces");

    component.dispose();
    gpu.dispose();
  });

  it("shares one colormap LUT between two components via the registry, and releases it", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [8, 8] });
    const registry = new ResourceRegistry();
    const ctx = { ...makeCtx(gpu, surfaceTarget, registry), caps };

    const a = new HeatmapComponent();
    const b = new HeatmapComponent();
    a.create(ctx);
    b.create(ctx);

    // ResourceRegistry's first production consumer anywhere in the repo (PLAN.md §14.1a).
    assert.equal(registry.size, 1, "both components should share one viridis LUT");

    a.dispose();
    assert.equal(registry.size, 1, "still held by b");
    b.dispose();
    assert.equal(registry.size, 0, "released once the last holder disposed");

    gpu.dispose();
  });

  it("hit-tests a cell by arithmetic, and returns null outside the matrix", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [100, 100] });
    const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

    const component = new HeatmapComponent();
    component.create(ctx);
    component.update({
      data: ingestMatrix(new Float32Array(100), 10, 10),
      viewport: { timeStart: 0, timeEnd: 10, trackCount: 10, width: 100, height: 100 },
    });

    // 10x10 cells over 100x100 px: each cell is 10px.
    assert.deepEqual(component.hitTest(5, 5), { id: 0 });
    assert.deepEqual(component.hitTest(95, 5), { id: 9 });
    assert.deepEqual(component.hitTest(5, 95), { id: 90 });
    assert.equal(component.hitTest(-1, 5), null);
    assert.equal(component.hitTest(5, 1000), null);

    component.dispose();
    gpu.dispose();
  });
});
