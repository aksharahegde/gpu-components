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
import { WhiteboardComponent } from "./WhiteboardComponent.ts";
import type { WhiteboardShape } from "./ingest.ts";

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

const VIEWPORT: ViewportState = {
  timeStart: 0,
  timeEnd: 8,
  trackCount: 8,
  rowStart: 0,
  rowEnd: 8,
  yContinuous: true,
  width: W,
  height: H,
};

const RECT: WhiteboardShape = { id: "rect-1", kind: "rect", x: 2, y: 2, w: 4, h: 4 };

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

interface Rendered {
  readonly pixels: Uint8Array;
  readonly painted: number;
  readonly component: WhiteboardComponent;
}

async function render(
  gpu: Gpu,
  props: Partial<Parameters<WhiteboardComponent["update"]>[0]> = {},
): Promise<Rendered> {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new WhiteboardComponent();
  component.create(makeCtx(gpu, surfaceTarget));
  component.update({ shapes: [], viewport: VIEWPORT, ...props });

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

describe("GPUWhiteboard render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("paints the background dot-grid even with zero shapes", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { painted } = await render(gpu);
    // The whole surface is covered by the background raster, so every pixel is "painted" by the
    // fills-not-black test — the real assertion is that this doesn't throw and produces a full frame.
    assert.equal(painted, W * H, `expected the full ${W * H}-pixel surface covered, got ${painted}`);
  });

  it("draws a rect on top of the background, changing the rendered image", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const withoutRect = await render(gpu);
    const withRect = await render(gpu, { shapes: [RECT] });

    assert.notDeepEqual(withRect.pixels, withoutRect.pixels, "the rect must change the rendered image");

    withoutRect.component.dispose();
    withRect.component.dispose();
  });

  it("highlights a hovered shape differently from an unhovered one", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const plain = await render(gpu, { shapes: [RECT] });
    const hovered = await render(gpu, { shapes: [RECT], hoveredId: "rect-1" });

    assert.notDeepEqual(hovered.pixels, plain.pixels, "hover must change the rendered image");

    plain.component.dispose();
    hovered.component.dispose();
  });

  it("highlights a multi-shape selection differently from no selection", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const other: WhiteboardShape = { id: "rect-2", kind: "rect", x: 4, y: 4, w: 2, h: 2 };
    const plain = await render(gpu, { shapes: [RECT, other] });
    const selected = await render(gpu, { shapes: [RECT, other], selectedIds: new Set(["rect-1", "rect-2"]) });

    assert.notDeepEqual(selected.pixels, plain.pixels, "a multi-shape selection must change the rendered image");

    plain.component.dispose();
    selected.component.dispose();
  });

  it("hit-tests a rendered rect back to its id through the real viewport transform", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { component } = await render(gpu, { shapes: [RECT] });

    // 8-unit domain over a 64px surface: 8 screen px per unit. RECT covers domain (2,2)-(6,6).
    assert.deepEqual(component.hitTest(32, 32), { id: "rect-1" });
    assert.equal(component.hitTest(2, 2), null);

    component.dispose();
  });
});
