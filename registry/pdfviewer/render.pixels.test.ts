import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type Capabilities,
  type ComponentContext,
  type ViewportState,
} from "@gpu-components/core";
import { PdfViewerComponent } from "./PdfViewerComponent.ts";
import { ingestPdfDocument, type PdfPage } from "./ingest.ts";

const CAPS: Capabilities = {
  ...NO_WEBGPU_CAPABILITIES,
  webgpu: true,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  tier: "gpu",
};

const W = 64;
const H = 64;

/** A page bitmap filled with a solid mid-gray, so any real draw lights up most of the surface. */
function solidPage(pageNumber: number, w = 20, h = 26): PdfPage {
  const bitmap = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    bitmap[i * 4 + 0] = 180;
    bitmap[i * 4 + 1] = 180;
    bitmap[i * 4 + 2] = 180;
    bitmap[i * 4 + 3] = 255;
  }
  return { pageNumber, width: w, height: h, bitmap: { data: bitmap, width: w, height: h } };
}

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
    caps: CAPS,
    onDispose: () => {},
  };
}

describe("GPUPdfViewer render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("paints a resident page as a real textured quad", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");

    const doc = ingestPdfDocument([solidPage(1)], { pageGap: 4 });
    const viewport: ViewportState = {
      timeStart: -doc.maxWidth / 2,
      timeEnd: doc.maxWidth / 2,
      trackCount: 1,
      rowStart: 0,
      rowEnd: doc.totalHeight,
      yContinuous: true,
      width: W,
      height: H,
    };

    const surfaceTarget = target(gpu, { size: [W, H] });
    const component = new PdfViewerComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ document: doc, viewport });

    const plan = component.plan();
    assert.equal(plan.computePasses.length, 0);

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
    assert.ok(painted > 40, `expected a painted page, got ${painted} lit pixels`);

    component.dispose();
  });

  it("scrolling past a page's preload margin evicts its texture and stops drawing it", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");

    const doc = ingestPdfDocument([solidPage(1), solidPage(2)], { pageGap: 4 });
    const nearTop: ViewportState = {
      timeStart: -doc.maxWidth / 2,
      timeEnd: doc.maxWidth / 2,
      trackCount: 1,
      rowStart: 0,
      rowEnd: 20,
      yContinuous: true,
      width: W,
      height: H,
    };
    const nearBottom: ViewportState = { ...nearTop, rowStart: doc.totalHeight - 20, rowEnd: doc.totalHeight };

    const surfaceTarget = target(gpu, { size: [W, H] });
    const component = new PdfViewerComponent();
    component.create(makeCtx(gpu, surfaceTarget));

    component.update({ document: doc, viewport: nearTop });
    assert.deepEqual(component.hitTest(W / 2, 5), { id: 1 });

    component.update({ document: doc, viewport: nearBottom });
    assert.deepEqual(component.hitTest(W / 2, H - 5), { id: 2 });

    const plan = component.plan();
    assert.doesNotThrow(() => {
      frame(gpu, (f) => {
        f.pass({ target: surfaceTarget, clear: true }, (fp) => {
          for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
        });
      });
    });
    await gpu.settled();

    component.dispose();
  });
});
