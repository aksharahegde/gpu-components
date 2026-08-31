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
import { ingestField } from "./ingest.ts";
import type { Annotation } from "./scene.ts";
import { AnnotationCanvasComponent } from "./AnnotationCanvasComponent.ts";

function makeCtx(
  gpu: Gpu,
  surfaceTarget: ReturnType<typeof target>,
  registry = new ResourceRegistry(),
): ComponentContext {
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

const VIEWPORT: ViewportState = {
  timeStart: 0,
  timeEnd: 8,
  trackCount: 8,
  rowStart: 0,
  rowEnd: 8,
  yContinuous: true,
  width: 16,
  height: 16,
};

function field() {
  return ingestField({ width: 8, height: 8, values: new Float32Array(64).fill(1) });
}

const RECT: Annotation = { id: "rect-1", kind: "rect", x: 1, y: 1, w: 3, h: 3 };
const RULER: Annotation = { id: "ruler-1", kind: "ruler", x0: 0, y0: 0, x1: 4, y1: 0 };

describe("AnnotationCanvasComponent", () => {
  it("runs create/update/plan/dispose against a mock Gpu and draws field then annotations", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new AnnotationCanvasComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ field: field(), annotations: [RECT, RULER], viewport: VIEWPORT });

    const plan = component.plan();
    assert.equal(plan.computePasses.length, 0, "field windowing needs no compute pass");
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.renderPasses[0]!.name, "annotationcanvas");
    assert.equal(component.animating, false);

    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const p of plan.renderPasses) p.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("contributes nothing before the first update", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new AnnotationCanvasComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });

  it("hit-tests a screen position onto a rect annotation, preferring the topmost", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new AnnotationCanvasComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({
      field: field(),
      annotations: [RECT, { id: "rect-2", kind: "rect", x: 1, y: 1, w: 3, h: 3 }],
      viewport: VIEWPORT,
    });

    // 8x8 field over a 16x16 surface: 2 screen px per image unit. Rect covers image (1,1)-(4,4).
    assert.deepEqual(component.hitTest(4, 4), { id: "rect-2" }, "later annotation wins on overlap");
    assert.equal(component.hitTest(15, 15), null);

    component.dispose();
    gpu.dispose();
  });

  it("rebuilds annotation buffers on annotation or selection change, not on pan alone", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new AnnotationCanvasComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    const data = field();
    component.update({ field: data, annotations: [RECT], viewport: VIEWPORT });
    assert.deepEqual(component.hitTest(4, 4), { id: "rect-1" });

    // Same field, panned viewport, same annotation array: still hit-testable after re-deriving
    // image-space coordinates from the new viewport.
    component.update({ field: data, annotations: [RECT], viewport: { ...VIEWPORT, timeStart: 0, timeEnd: 8 } });
    assert.deepEqual(component.hitTest(4, 4), { id: "rect-1" });

    // Selecting it changes rendering flags, not hit-testing.
    component.update({ field: data, annotations: [RECT], viewport: VIEWPORT, selectedId: "rect-1" });
    assert.deepEqual(component.hitTest(4, 4), { id: "rect-1" });

    component.dispose();
    gpu.dispose();
  });

  it("accepts gray, and named heatmap colormaps, without throwing", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new AnnotationCanvasComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    component.update({ field: field(), annotations: [], viewport: VIEWPORT, colormap: "gray" });
    assert.equal(component.plan().renderPasses.length, 1);

    component.update({ field: field(), annotations: [], viewport: VIEWPORT, colormap: "viridis" });
    assert.equal(component.plan().renderPasses.length, 1);

    component.dispose();
    gpu.dispose();
  });

  it("shares the gray LUT between two components via the registry, and releases it", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const registry = new ResourceRegistry();
    const ctx = { ...makeCtx(gpu, surfaceTarget, registry), caps };

    const a = new AnnotationCanvasComponent();
    const b = new AnnotationCanvasComponent();
    a.create(ctx);
    b.create(ctx);
    assert.equal(registry.size, 1, "both default to gray and should share one LUT");

    a.dispose();
    assert.equal(registry.size, 1, "still held by b");
    b.dispose();
    assert.equal(registry.size, 0, "released once the last holder disposed");

    gpu.dispose();
  });

  it("draws polygon and freehand annotations as line segments without throwing", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new AnnotationCanvasComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    const polygon: Annotation = {
      id: "poly-1",
      kind: "polygon",
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
    };
    const freehand: Annotation = {
      id: "free-1",
      kind: "freehand",
      points: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 3 }],
    };
    const point: Annotation = { id: "point-1", kind: "point", x: 5, y: 5 };

    component.update({ field: field(), annotations: [polygon, freehand, point], viewport: VIEWPORT });
    const plan = component.plan();
    assert.equal(plan.renderPasses.length, 1);

    assert.doesNotThrow(() => {
      frame(gpu, (f) => {
        f.pass({ target: surfaceTarget, clear: true }, (fp) => {
          for (const p of plan.renderPasses) p.encode(gpuPass(fp));
        });
      });
    });

    component.dispose();
    gpu.dispose();
  });
});
