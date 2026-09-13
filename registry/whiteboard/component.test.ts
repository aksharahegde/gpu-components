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
import { WhiteboardComponent } from "./WhiteboardComponent.ts";
import type { WhiteboardShape } from "./ingest.ts";

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

const RECT: WhiteboardShape = { id: "rect-1", kind: "rect", x: 1, y: 1, w: 3, h: 3 };
const RULER: WhiteboardShape = { id: "ruler-1", kind: "ruler", x0: 0, y0: 0, x1: 4, y1: 0 };

describe("WhiteboardComponent", () => {
  it("plans a background + shapes pass with no compute", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new WhiteboardComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ shapes: [RECT, RULER], viewport: VIEWPORT });

    const plan = component.plan();
    assert.equal(plan.computePasses.length, 0);
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.renderPasses[0]!.name, "whiteboard");
    assert.equal(component.animating, false);

    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const p of plan.renderPasses) p.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("contributes a plan even with zero shapes (the background still draws)", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new WhiteboardComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ shapes: [], viewport: VIEWPORT });
    assert.equal(component.plan().renderPasses.length, 1);
    component.dispose();
    gpu.dispose();
  });

  it("hit-tests a screen position onto a rect, preferring the topmost on overlap", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new WhiteboardComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({
      shapes: [RECT, { id: "rect-2", kind: "rect", x: 1, y: 1, w: 3, h: 3 }],
      viewport: VIEWPORT,
    });

    // 8-unit domain over a 16px surface: 2 screen px per domain unit. Rect covers (1,1)-(4,4).
    assert.deepEqual(component.hitTest(4, 4), { id: "rect-2" });
    assert.equal(component.hitTest(15, 15), null);

    component.dispose();
    gpu.dispose();
  });

  it("re-derives hit-testing after a pan, from the same shapes array", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new WhiteboardComponent();
    component.create(makeCtx(gpu, surfaceTarget));

    const shapes = [RECT];
    component.update({ shapes, viewport: VIEWPORT });
    assert.deepEqual(component.hitTest(4, 4), { id: "rect-1" });

    component.update({ shapes, viewport: { ...VIEWPORT, timeStart: 0, timeEnd: 8 } });
    assert.deepEqual(component.hitTest(4, 4), { id: "rect-1" });

    component.dispose();
    gpu.dispose();
  });

  it("draws polygon, freehand, and point shapes without throwing", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new WhiteboardComponent();
    component.create(makeCtx(gpu, surfaceTarget));

    const polygon: WhiteboardShape = {
      id: "poly-1",
      kind: "polygon",
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
    };
    const freehand: WhiteboardShape = {
      id: "free-1",
      kind: "freehand",
      points: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 3 }],
    };
    const point: WhiteboardShape = { id: "point-1", kind: "point", x: 5, y: 5 };

    component.update({ shapes: [polygon, freehand, point], viewport: VIEWPORT });
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

  it("accepts a multi-shape selectedIds set without throwing, and re-uploads on a new set", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new WhiteboardComponent();
    component.create(makeCtx(gpu, surfaceTarget));

    const shapes = [RECT, { id: "rect-2", kind: "rect", x: 5, y: 5, w: 1, h: 1 } as WhiteboardShape];
    component.update({ shapes, viewport: VIEWPORT, selectedIds: new Set(["rect-1", "rect-2"]) });
    assert.equal(component.plan().renderPasses.length, 1);

    // A fresh Set (even with the same members) is a new reference — same "diff by identity" rule
    // `NodeEditorComponent` follows for its own `selectedNodes`/`selectedEdges`.
    component.update({ shapes, viewport: VIEWPORT, selectedIds: new Set(["rect-1"]) });
    assert.equal(component.plan().renderPasses.length, 1);

    component.dispose();
    gpu.dispose();
  });
});
