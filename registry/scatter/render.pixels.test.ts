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
import { ingestPoints } from "./ingest.ts";
import { ScatterComponent } from "./ScatterComponent.ts";

const CAPS: Capabilities = {
  ...NO_WEBGPU_CAPABILITIES,
  webgpu: true,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  tier: "gpu",
};

const W = 200;
const H = 200;

/** Four points, one per corner of a [0,10]^2 domain, plus one dead centre. Categories differ so
 * the palette and the category filter are both observable. */
const DATA = ingestPoints([
  { x: 0, y: 0, category: 0 },
  { x: 10, y: 0, category: 1 },
  { x: 0, y: 10, category: 2 },
  { x: 10, y: 10, category: 3 },
  { x: 5, y: 5, category: 4 },
]);

const VIEWPORT: ViewportState = {
  timeStart: 0,
  timeEnd: 10,
  trackCount: 10,
  rowStart: 0,
  rowEnd: 10,
  yContinuous: true,
  width: W,
  height: H,
};

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
  readonly component: ScatterComponent;
}

async function render(gpu: Gpu, props: Partial<Parameters<ScatterComponent["update"]>[0]> = {}): Promise<Rendered> {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new ScatterComponent(64);
  component.create(makeCtx(gpu, surfaceTarget));
  component.update({ data: DATA, viewport: VIEWPORT, pointSizePx: 20, ...props });

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

const lit = (pixels: Uint8Array, x: number, y: number) => {
  const i = (y * W + x) * 4;
  return pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0;
};

describe("GPUScatter render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("draws a disc at each point's transformed position, and nothing between them", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { pixels, component } = await render(gpu);

    // Data (5,5) is the centre of the surface. y inverts, so (0,0) is bottom-left.
    assert.ok(lit(pixels, 100, 100), "the centre point should be drawn");
    assert.ok(lit(pixels, 2, 197), "data (0,0) lands bottom-left");
    assert.ok(lit(pixels, 197, 2), "data (10,10) lands top-right");
    // A quarter of the way in is empty — no point is anywhere near it.
    assert.ok(!lit(pixels, 50, 50), "empty space stays empty");

    component.dispose();
  });

  it("draws discs, not squares — the quad's corners are transparent", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { pixels, component } = await render(gpu);

    // A 20px disc at (100,100) covers the centre but not the quad's corner at (109,109).
    assert.ok(lit(pixels, 100, 100), "disc centre");
    assert.ok(!lit(pixels, 109, 109), "the quad corner must be discarded, or it is a square");

    component.dispose();
  });

  it("filters by category with a uniform write — the data buffer never changes", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const all = await render(gpu);
    // categoryFilter is 1-based: 5 keeps only category 4, the centre point.
    const filtered = await render(gpu, { categoryFilter: 5 });

    assert.ok(filtered.painted > 0, "the surviving point should still be drawn");
    // Not a 5x drop: the four corner points sit exactly on the surface edges, so each contributes
    // only a quarter-disc, and the single full disc at the centre is about half the total. What
    // matters is that pixels went away and the *right* ones stayed.
    assert.ok(
      filtered.painted < all.painted,
      `filtering should remove pixels: ${all.painted} -> ${filtered.painted}`,
    );
    const fullDisc = Math.PI * 10 * 10;
    assert.ok(
      Math.abs(filtered.painted - fullDisc) < fullDisc * 0.25,
      `what remains should be one full 20px disc (~${Math.round(fullDisc)}px), got ${filtered.painted}`,
    );
    assert.ok(lit(filtered.pixels, 100, 100), "the kept category is the centre point");
    assert.ok(!lit(filtered.pixels, 2, 197), "a filtered-out point must vanish");

    all.component.dispose();
    filtered.component.dispose();
  });

  it("grows the hovered point, so hover is visible without a second draw", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const plain = await render(gpu, { categoryFilter: 5 });
    const hovered = await render(gpu, { categoryFilter: 5, hoveredIndex: 4 });

    assert.ok(
      hovered.painted > plain.painted,
      `hover should enlarge the point: ${plain.painted} -> ${hovered.painted}`,
    );
    plain.component.dispose();
    hovered.component.dispose();
  });

  it("renders the selection bitset the render shader reads", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const surfaceTarget = target(gpu, { size: [W, H] });
    const component = new ScatterComponent(64);
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ data: DATA, viewport: VIEWPORT, pointSizePx: 20, categoryFilter: 5 });

    const before = await (async () => {
      const plan = component.plan();
      frame(gpu!, (f) => {
        f.pass({ target: surfaceTarget, clear: true }, (fp) => {
          for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
        });
      });
      await gpu!.settled();
      return (await surfaceTarget.read()) as Uint8Array;
    })();

    // Select the centre point: the shader brightens it and grows it by 1.4x.
    component.setSelection([4]);
    const plan = component.plan();
    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });
    await gpu.settled();
    const afterPixels = (await surfaceTarget.read()) as Uint8Array;

    const count = (p: Uint8Array) => {
      let n = 0;
      for (let i = 0; i < p.length; i += 4) if (p[i] || p[i + 1] || p[i + 2]) n++;
      return n;
    };
    assert.ok(count(afterPixels) > count(before), "a selected point should render larger");

    component.dispose();
  });
});
