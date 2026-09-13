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
  type ViewportState,
} from "@gpuc/core";
import { PdfViewerComponent } from "./PdfViewerComponent.ts";
import { ingestPdfDocument, type PdfPage } from "./ingest.ts";

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

function page(pageNumber: number): PdfPage {
  return { pageNumber, width: 8, height: 10, bitmap: { data: new Uint8Array(8 * 10 * 4), width: 8, height: 10 } };
}

function viewportFor(rowStart: number, rowEnd: number, w = 16, h = 16): ViewportState {
  return { timeStart: -4, timeEnd: 4, trackCount: 1, rowStart, rowEnd, yContinuous: true, width: w, height: h };
}

describe("PdfViewerComponent", () => {
  it("plans one pass, drawing nothing before the first update", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new PdfViewerComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });

  it("draws resident pages through a mock GPU without throwing", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new PdfViewerComponent();
    component.create(makeCtx(gpu, surfaceTarget));

    const doc = ingestPdfDocument([page(1), page(2), page(3)], { pageGap: 2 });
    component.update({ document: doc, viewport: viewportFor(0, 10) });

    const plan = component.plan();
    assert.equal(plan.computePasses.length, 0);
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.renderPasses[0]!.name, "pdfviewer");

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

  it("hit-tests a point inside a page to its 1-based page number, and null in the gap", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new PdfViewerComponent();
    component.create(makeCtx(gpu, surfaceTarget));

    const doc = ingestPdfDocument([page(1), page(2)], { pageGap: 2 });
    // Page 1: y 0-10. Gap: 10-12. Page 2: y 12-22. Document height 22 over a 16px surface (rowStart
    // 0, rowEnd 22): ~0.727 px per y-unit.
    const vp = viewportFor(0, 22);
    component.update({ document: doc, viewport: vp });

    const yToPx = (y: number) => (y / 22) * 16;
    assert.deepEqual(component.hitTest(8, yToPx(5)), { id: 1 });
    assert.deepEqual(component.hitTest(8, yToPx(17)), { id: 2 });
    assert.equal(component.hitTest(8, yToPx(11)), null, "the gap between pages hits nothing");

    component.dispose();
    gpu.dispose();
  });

  it("reassigns pool slots as the viewport scrolls past the preload margin", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new PdfViewerComponent();
    component.create(makeCtx(gpu, surfaceTarget));

    // Ten short pages, one screenful each — enough that scrolling from the top to the bottom
    // moves well outside the first view's preload margin.
    const doc = ingestPdfDocument(Array.from({ length: 10 }, (_, i) => page(i + 1)), { pageGap: 0 });
    component.update({ document: doc, viewport: viewportFor(0, 10) });
    assert.deepEqual(component.hitTest(8, 8), { id: 1 });

    component.update({ document: doc, viewport: viewportFor(80, 90) });
    assert.deepEqual(component.hitTest(8, 8), { id: 9 });

    assert.doesNotThrow(() => {
      const plan = component.plan();
      frame(gpu, (f) => {
        f.pass({ target: surfaceTarget, clear: true }, (fp) => {
          for (const p of plan.renderPasses) p.encode(gpuPass(fp));
        });
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("swapping the document invalidates every resident page even at the same viewport", async () => {
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new PdfViewerComponent();
    component.create(makeCtx(gpu, surfaceTarget));

    const docA = ingestPdfDocument([page(1)], { pageGap: 0 });
    component.update({ document: docA, viewport: viewportFor(0, 10) });
    assert.deepEqual(component.hitTest(8, 8), { id: 1 });

    const docB = ingestPdfDocument([page(42)], { pageGap: 0 });
    component.update({ document: docB, viewport: viewportFor(0, 10) });
    assert.deepEqual(component.hitTest(8, 8), { id: 42 });

    component.dispose();
    gpu.dispose();
  });
});
