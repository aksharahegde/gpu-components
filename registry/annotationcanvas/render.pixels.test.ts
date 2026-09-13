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
} from "@gpuc/core";
import { ingestField } from "./ingest.ts";
import type { Annotation } from "./scene.ts";
import { AnnotationCanvasComponent } from "./AnnotationCanvasComponent.ts";

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
const FIELD_DIM = 8;

const VIEWPORT: ViewportState = {
  timeStart: 0,
  timeEnd: FIELD_DIM,
  trackCount: FIELD_DIM,
  rowStart: 0,
  rowEnd: FIELD_DIM,
  yContinuous: true,
  width: W,
  height: H,
};

/** A small field with a mid-range value everywhere, so the colormap paints every pixel — the
 * baseline against which "an annotation adds more lit pixels" is compared. */
function field() {
  return ingestField({
    width: FIELD_DIM,
    height: FIELD_DIM,
    values: new Float32Array(FIELD_DIM * FIELD_DIM).fill(0.5),
    window: { min: 0, max: 1 },
  });
}

const RECT: Annotation = { id: "rect-1", kind: "rect", x: 2, y: 2, w: 4, h: 4 };

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

interface Rendered {
  readonly pixels: Uint8Array;
  readonly painted: number;
  readonly component: AnnotationCanvasComponent;
}

async function render(
  gpu: Gpu,
  props: Partial<Parameters<AnnotationCanvasComponent["update"]>[0]> = {},
): Promise<Rendered> {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new AnnotationCanvasComponent();
  component.create(makeCtx(gpu, surfaceTarget));
  component.update({ field: field(), annotations: [], viewport: VIEWPORT, ...props });

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

describe("GPUAnnotationCanvas render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("paints the field through the colormap, more than 20 pixels lit", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { painted, component } = await render(gpu);

    assert.ok(painted > 20, `expected more than 20 painted pixels, got ${painted}`);
    component.dispose();
  });

  it("draws a rect annotation on top of the field, adding lit stroke/fill pixels", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const withoutRect = await render(gpu);
    const withRect = await render(gpu, { annotations: [RECT] });

    assert.ok(withRect.painted > 20, `expected more than 20 painted pixels, got ${withRect.painted}`);
    // A field with a mid-value everywhere is already fully lit, so the rect's own contribution is
    // the *change* in rendered pixels (its brighter stroke/fill on top of the field), not the
    // painted count alone — this is why the diff is asserted rather than a fixed threshold.
    assert.notDeepEqual(withRect.pixels, withoutRect.pixels, "the rect must change the rendered image");

    withoutRect.component.dispose();
    withRect.component.dispose();
  });

  it("highlights the selected annotation differently from an unselected one", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const plain = await render(gpu, { annotations: [RECT] });
    const selected = await render(gpu, { annotations: [RECT], selectedId: "rect-1" });

    assert.notDeepEqual(selected.pixels, plain.pixels, "selection must change the rendered image");

    plain.component.dispose();
    selected.component.dispose();
  });

  it("hit-tests a rendered rect back to its id through the real viewport transform", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { component } = await render(gpu, { annotations: [RECT] });

    // 8-unit field over a 64px surface: 8 screen px per image unit. RECT covers image (2,2)-(6,6).
    assert.deepEqual(component.hitTest(32, 32), { id: "rect-1" });
    assert.equal(component.hitTest(2, 2), null);

    component.dispose();
  });
});
