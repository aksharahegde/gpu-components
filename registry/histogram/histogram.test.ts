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
import {
  clampBinCount,
  cpuHistogram,
  freedmanDiaconisBinCount,
  resolveBinCount,
  sturgesBinCount,
} from "./bins.ts";
import { ingestNumbers, ingestValues, withBinCount } from "./ingest.ts";
import { HistogramComponent } from "./HistogramComponent.ts";

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

describe("adaptive bins", () => {
  it("uses Sturges for tiny or zero-IQR samples", () => {
    assert.equal(sturgesBinCount(1), 1);
    assert.equal(sturgesBinCount(8), 4);
    assert.equal(freedmanDiaconisBinCount(10, 0, 0, 1), null);
    const r = resolveBinCount(8, 0, 0, 1);
    assert.equal(r.method, "sturges");
    assert.equal(r.binCount, 4);
  });

  it("uses Freedman–Diaconis when IQR is positive", () => {
    const r = resolveBinCount(1000, 2, 0, 20);
    assert.equal(r.method, "freedman-diaconis");
    assert.ok(r.binCount >= 1 && r.binCount <= 512);
  });

  it("honours an override and clamps to MAX_BINS", () => {
    assert.deepEqual(resolveBinCount(100, 1, 0, 10, 32), { binCount: 32, method: "override" });
    assert.equal(clampBinCount(10_000), 512);
    assert.equal(clampBinCount(0), 1);
  });
});

describe("histogram ingest", () => {
  it("computes domain and adaptive bins for a Gaussian-like sample", () => {
    const values = new Float32Array(10_000);
    for (let i = 0; i < values.length; i++) {
      // Irwin–Hall ≈ Gaussian
      let s = 0;
      for (let k = 0; k < 12; k++) s += (i * 17 + k * 31) % 1000;
      values[i] = s / 1000 - 6;
    }
    const data = ingestValues(values);
    assert.equal(data.method, "freedman-diaconis");
    assert.ok(data.binCount >= 8 && data.binCount <= 512);
    assert.ok(data.domain.max > data.domain.min);
    assert.ok(Math.abs(data.binWidth * data.binCount - (data.domain.max - data.domain.min)) < 1e-6);
  });

  it("falls back to Sturges for a constant series", () => {
    const data = ingestNumbers([3, 3, 3, 3]);
    assert.equal(data.method, "sturges");
    assert.ok(data.domain.max > data.domain.min);
  });

  it("withBinCount overrides without changing values", () => {
    const data = ingestNumbers([1, 2, 3, 4, 5]);
    const next = withBinCount(data, 16);
    assert.equal(next.binCount, 16);
    assert.equal(next.method, "override");
    assert.equal(next.values, data.values);
  });
});

describe("cpuHistogram oracle", () => {
  it("counts every finite value in range exactly once", () => {
    const values = Float32Array.from([0, 1, 2, 3, 4, Number.NaN]);
    const bins = cpuHistogram(values, values.length, 0, 5, 5);
    assert.equal(bins.reduce((a, b) => a + b, 0), 5);
    assert.deepEqual([...bins], [1, 1, 1, 1, 1]);
  });
});

describe("HistogramComponent", () => {
  it("plans bin + reduce + a surface pass, and skips compute on pan", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const component = new HistogramComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    const data = ingestNumbers([0, 1, 1, 2, 2, 2, 3, 4], { binCount: 5 });
    const viewport = {
      timeStart: data.domain.min,
      timeEnd: data.domain.max,
      trackCount: 1,
      rowStart: 0,
      rowEnd: 1,
      yContinuous: true,
      width: 64,
      height: 64,
    };
    component.update({ data, viewport });

    const plan = component.plan();
    assert.equal(plan.computePasses.length, 2);
    assert.equal(plan.renderPasses.length, 1);
    assert.ok(plan.computePasses.some((p) => p.name === "histogram-bin"));

    component.update({
      data,
      viewport: { ...viewport, timeStart: data.domain.min + 0.1, timeEnd: data.domain.max - 0.1 },
    });
    const again = component.plan();
    assert.equal(again.computePasses.length, 0, "panning must not re-bin");

    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("hit-tests a bin from screen x", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [100, 50] });
    const component = new HistogramComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    const data = ingestNumbers([0, 1, 2, 3, 4], { binCount: 5 });
    component.update({
      data,
      viewport: {
        timeStart: 0,
        timeEnd: 5,
        trackCount: 1,
        rowStart: 0,
        rowEnd: 1,
        yContinuous: true,
        width: 100,
        height: 50,
      },
    });
    const hit = component.hitTest(30, 10);
    assert.ok(hit);
    assert.equal(hit!.id, 1);
    component.dispose();
    gpu.dispose();
  });
});
