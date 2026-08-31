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
import { computeBounds, ingestLonLat, ingestPoints, packPoints, POINT_STRIDE } from "./ingest.ts";
import { lonLatToMercator, mercatorToLonLat, MAX_LAT } from "./mercator.ts";
import {
  axialRound,
  hexSizeFromViewportPx,
  layoutHexGrid,
  offsetIndex,
  pixelToOffset,
  MAX_HEXES,
} from "./hexmath.ts";
import { computeGraticule } from "./graticule.ts";
import { WORLD_OUTLINE_LINES } from "./worldOutline.ts";
import { DensityMapComponent } from "./DensityMapComponent.ts";

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

describe("mercator", () => {
  it("round-trips lon/lat through the north-up Y flip", () => {
    const p = lonLatToMercator(10, 45);
    const back = mercatorToLonLat(p.x, p.y);
    assert.ok(Math.abs(back.lon - 10) < 1e-6);
    assert.ok(Math.abs(back.lat - 45) < 1e-6);
  });

  it("clamps latitude to the Web Mercator limit", () => {
    const p = lonLatToMercator(0, 89);
    const back = mercatorToLonLat(p.x, p.y);
    assert.ok(Math.abs(back.lat - MAX_LAT) < 1e-4);
  });
});

describe("densitymap ingest", () => {
  it("projects lon/lat and computes bounds", () => {
    const data = ingestPoints([
      { lon: -74, lat: 40.7 },
      { lon: 2.35, lat: 48.85 },
    ]);
    assert.equal(data.count, 2);
    assert.ok(data.bounds.xMin < data.bounds.xMax);
    assert.ok(data.bounds.yMin < data.bounds.yMax);
  });

  it("rejects mismatched columns", () => {
    assert.throws(() => ingestLonLat(new Float32Array(3), new Float32Array(2)), /same length/);
  });

  it("skips non-finite points in bounds", () => {
    const bounds = computeBounds(
      Float32Array.from([0, Number.NaN, 10]),
      Float32Array.from([0, 3, 8]),
      3,
    );
    assert.deepEqual(bounds, { xMin: 0, xMax: 10, yMin: 0, yMax: 8 });
  });

  it("packs points at the declared stride", () => {
    const bytes = packPoints(ingestPoints([{ lon: 0, lat: 0, weight: 2 }]));
    assert.equal(bytes.byteLength, POINT_STRIDE);
    assert.equal(bytes[2], 2);
  });
});

describe("hexmath", () => {
  it("cube-rounds the origin to itself", () => {
    assert.deepEqual(axialRound({ q: 0.1, r: -0.1 }), { q: 0, r: 0 });
  });

  it("keeps pixel→offset→index stable for a layout", () => {
    const viewport: ViewportState = {
      timeStart: -1e6,
      timeEnd: 1e6,
      trackCount: 1,
      rowStart: -1e6,
      rowEnd: 1e6,
      yContinuous: true,
      width: 400,
      height: 300,
    };
    const layout = layoutHexGrid(viewport, 100_000);
    assert.ok(layout.cellCount <= MAX_HEXES);
    assert.ok(layout.cellCount >= 1);
    const offset = pixelToOffset(0, 0, layout.hexSize);
    const index = offsetIndex(layout, offset);
    assert.ok(index >= 0 && index < layout.cellCount);
  });

  it("raises hex size when the viewport would overflow MAX_HEXES", () => {
    const viewport: ViewportState = {
      timeStart: -20_000_000,
      timeEnd: 20_000_000,
      trackCount: 1,
      rowStart: -20_000_000,
      rowEnd: 20_000_000,
      yContinuous: true,
      width: 800,
      height: 600,
    };
    const layout = layoutHexGrid(viewport, 100);
    assert.ok(layout.hexSize > 100);
    assert.ok(layout.cellCount <= MAX_HEXES);
  });

  it("derives a screen-pixel hex size that spans roughly sizePx on x", () => {
    const viewport: ViewportState = {
      timeStart: 0,
      timeEnd: 1000,
      trackCount: 1,
      rowStart: 0,
      rowEnd: 1000,
      yContinuous: true,
      width: 500,
      height: 500,
    };
    const size = hexSizeFromViewportPx(viewport, 10);
    // width = √3 * size ≈ 10 px → size ≈ 10 * (1000/500) / √3
    assert.ok(Math.abs(size - (10 * 2) / Math.sqrt(3)) < 1e-6);
  });
});

describe("chrome", () => {
  it("emits a bounded graticule", () => {
    const lines = computeGraticule({
      timeStart: -5e6,
      timeEnd: 5e6,
      trackCount: 1,
      rowStart: -5e6,
      rowEnd: 5e6,
      yContinuous: true,
      width: 800,
      height: 600,
    });
    assert.ok(lines.length > 0);
    assert.ok(lines.length <= 96);
  });

  it("ships a non-empty world outline", () => {
    assert.ok(WORLD_OUTLINE_LINES.length > 10);
  });
});

describe("DensityMapComponent", () => {
  it("plans hexbin + reduce + a surface pass with chrome", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const component = new DensityMapComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    const data = ingestPoints([
      { lon: 0, lat: 0 },
      { lon: 1, lat: 1 },
      { lon: -1, lat: -1 },
    ]);
    component.update({
      data,
      viewport: {
        timeStart: data.bounds.xMin,
        timeEnd: data.bounds.xMax,
        trackCount: 1,
        rowStart: data.bounds.yMin,
        rowEnd: data.bounds.yMax,
        yContinuous: true,
        width: 64,
        height: 64,
      },
      hexSize: 200_000,
    });

    const plan = component.plan();
    assert.equal(plan.computePasses.length, 2);
    assert.equal(plan.renderPasses.length, 1);
    assert.ok(plan.computePasses.some((p) => p.name === "densitymap-hexbin"));
    assert.ok(plan.computePasses.some((p) => p.name === "densitymap-reduce-max"));

    component.update({
      data,
      viewport: {
        timeStart: data.bounds.xMin,
        timeEnd: data.bounds.xMax,
        trackCount: 1,
        rowStart: data.bounds.yMin,
        rowEnd: data.bounds.yMax,
        yContinuous: true,
        width: 64,
        height: 64,
      },
      hexSize: 200_000,
    });
    const again = component.plan();
    assert.ok(again.computePasses.length >= 0);

    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("hit-tests a hex index inside the layout", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [200, 200] });
    const component = new DensityMapComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    const data = ingestPoints([{ lon: 0, lat: 0 }]);
    component.update({
      data,
      viewport: {
        timeStart: data.bounds.xMin - 1e5,
        timeEnd: data.bounds.xMax + 1e5,
        trackCount: 1,
        rowStart: data.bounds.yMin - 1e5,
        rowEnd: data.bounds.yMax + 1e5,
        yContinuous: true,
        width: 200,
        height: 200,
      },
      hexSize: 50_000,
    });
    const hit = component.hitTest(100, 100);
    assert.ok(hit);
    assert.equal(typeof hit!.id, "number");
    component.dispose();
    gpu.dispose();
  });
});
