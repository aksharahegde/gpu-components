import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createViewportController, rowRange, type ViewportState } from "@gpuc/core";
import { createRecordingContext2D } from "@gpuc/testing";
import { target, uniforms, type Gpu } from "vgpu";
import { createMockGpu } from "@gpuc/testing";
import {
  createWarningsLog,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type Canvas2DPassEncoder,
  type ComponentContext,
} from "@gpuc/core";
import { viewportUniforms } from "@gpuc/core";
import { ingestMatrix } from "./ingest.ts";
import { HeatmapComponent } from "./HeatmapComponent.ts";

const VIEWPORT: ViewportState = {
  timeStart: 0,
  timeEnd: 8,
  trackCount: 8,
  rowStart: 0,
  rowEnd: 8,
  width: 160,
  height: 160,
};
const BOUNDS = { timeMin: 0, timeMax: 8, rowMin: 0, rowMax: 8 };

describe("heatmap two-axis interaction (the capability core gained for this component)", () => {
  /** Zoomed in to 4 of the 8 rows — a viewport already showing every row has nothing to scroll,
   * which is itself the correct behaviour and is covered by the clamping test below. */
  const ZOOMED: ViewportState = { ...VIEWPORT, rowStart: 0, rowEnd: 4 };

  it("pans vertically, which was impossible before the row range existed", () => {
    const c = createViewportController(ZOOMED, BOUNDS);
    c.panByPixels(0, 80); // half the surface height, showing 4 rows => 2 rows
    const [start, end] = rowRange(c.getState());
    assert.ok(start > 1.9 && start < 2.1, `expected to scroll ~2 rows, got ${start}`);
    assert.equal(end - start, 4, "panning must not change the zoom level");
  });

  it("clamps vertical panning to the matrix, both edges", () => {
    const c = createViewportController(ZOOMED, BOUNDS);
    c.panByPixels(0, 10_000);
    assert.deepEqual(rowRange(c.getState()), [4, 8], "cannot scroll past the last row");
    c.panByPixels(0, -10_000);
    assert.deepEqual(rowRange(c.getState()), [0, 4], "cannot scroll above the first row");
  });

  it("has nothing to pan when every row is already visible", () => {
    const c = createViewportController(VIEWPORT, BOUNDS);
    c.panByPixels(0, 500);
    assert.deepEqual(rowRange(c.getState()), [0, 8]);
  });

  it("zooms the y axis toward the pointer, keeping that row fixed", () => {
    const c = createViewportController(VIEWPORT, BOUNDS);
    // Zoom in 2x centred on the very top of the surface: the top row must stay put.
    c.zoomAtY(0, 0.5);
    const [start, end] = rowRange(c.getState());
    assert.equal(start, 0, "the row under the cursor stays fixed");
    assert.equal(end - start, 4, "2x zoom halves the visible rows");
  });

  it("leaves the y axis alone for a viewport that never opted into one", () => {
    // The Timeline's case: no rowStart/rowEnd. zoomAtY and vertical pan must be inert, so adding
    // the axis to core cannot make an existing component start scrolling.
    const timelineish: ViewportState = { timeStart: 0, timeEnd: 10, trackCount: 4, width: 100, height: 100 };
    const c = createViewportController(timelineish, { timeMin: 0, timeMax: 10 });
    c.zoomAtY(50, 0.5);
    c.panByPixels(0, 50);
    const state = c.getState();
    assert.equal(state.rowStart, undefined);
    assert.equal(state.rowEnd, undefined);
    assert.deepEqual(rowRange(state), [0, 4]);
  });

  it("still zooms x independently, so the two axes do not fight", () => {
    const c = createViewportController(VIEWPORT, BOUNDS);
    c.zoomAt(0, 0.5);
    const s = c.getState();
    assert.equal(s.timeEnd - s.timeStart, 4, "x zoomed");
    assert.deepEqual(rowRange(s), [0, 8], "y untouched");
  });
});

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

describe("heatmap Canvas2D fallback (PLAN.md §22)", () => {
  it("shades every pixel through the CPU colormap when there is no GPU", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [8, 8] });
    const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

    const component = new HeatmapComponent();
    component.create(ctx);
    component.update({
      data: ingestMatrix([0, 1, 2, 3], 2, 2),
      viewport: { timeStart: 0, timeEnd: 2, trackCount: 2, width: 8, height: 8 },
    });

    const recorder = createRecordingContext2D();
    const reports: string[] = [];
    const pass: Canvas2DPassEncoder = {
      kind: "canvas2d",
      ctx: recorder.ctx,
      width: 8,
      height: 8,
      viewport: viewportUniforms({ timeStart: 0, timeEnd: 2, trackCount: 2, width: 8, height: 8 }),
      report: (r) => reports.push(r),
    };

    for (const p of component.plan().renderPasses) p.encode(pass);

    assert.equal(recorder.calls.length, 1, "one putImageData for the whole surface");
    const put = recorder.calls[0]!;
    assert.equal(put.op, "putImageData");
    if (put.op === "putImageData") {
      assert.equal(put.width, 8);
      assert.equal(put.firstPixelAlpha, 255, "the top-left cell must be painted, not left transparent");
    }
    assert.deepEqual(reports, [], "a matrix that fits needs no degradation report");

    component.dispose();
    gpu.dispose();
  });
});

describe("mount-order safety", () => {
  it("survives a frame encoded between create() and the first update()", async () => {
    // The exact sequence that broke in the browser: `useGpuComponent` mounts in one effect and
    // calls update() in another, and a rAF tick can land between them. Before the placeholder
    // allocation, vgpu threw `Unset values @group(0) @binding(2)` at encode time. The earlier pixel
    // test never caught it because it calls create/update/plan synchronously.
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [8, 8] });
    const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

    const component = new HeatmapComponent();
    component.create(ctx);

    const plan = component.plan();
    assert.deepEqual(plan.renderPasses, [], "an empty component should contribute no passes");
    assert.deepEqual(plan.computePasses, []);

    component.update({
      data: ingestMatrix([1, 2, 3, 4], 2, 2),
      viewport: { timeStart: 0, timeEnd: 2, trackCount: 2, width: 8, height: 8 },
    });
    assert.equal(component.plan().renderPasses.length, 1);

    component.dispose();
    gpu.dispose();
  });
});
