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
} from "@gpu-components/core";
import { ingestRows, type GridColumn } from "./ingest.ts";
import { GridComponent } from "./GridComponent.ts";

/**
 * `GPUDataGrid` render correctness through real Dawn — written with the component, per the lesson
 * of the Timeline's blank canvas and the Heatmap's blank canvas. Asserts the things that would
 * silently break: that anything is drawn at all, that zebra striping alternates, that conditional
 * formatting actually varies with the data, and that horizontal scroll moves the column rules.
 */

const CAPS: Capabilities = {
  ...NO_WEBGPU_CAPABILITIES,
  webgpu: true,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  tier: "gpu",
};

const W = 240;
const H = 200;

const COLUMNS: GridColumn[] = [
  { key: "name", label: "Name", width: 120 },
  { key: "score", label: "Score", width: 120, numeric: true, align: "right" },
];
/** 10 rows, score climbing 0..9, so conditional formatting must vary top to bottom. */
const DATA = ingestRows(
  Array.from({ length: 10 }, (_, i) => ({ name: `r${i}`, score: i })),
  COLUMNS,
);
/** 10 rows over 200px = 20px per row; two 120px columns exactly fill the 240px surface. */
const VIEWPORT = { timeStart: 0, timeEnd: 1, trackCount: 10, rowStart: 0, rowEnd: 10, width: W, height: H };

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

async function render(gpu: Gpu, scrollX = 0): Promise<{ pixels: Uint8Array; component: GridComponent }> {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new GridComponent();
  component.create(makeCtx(gpu, surfaceTarget));
  component.update({ data: DATA, viewport: VIEWPORT, scrollX });

  const plan = component.plan();
  frame(gpu, (f) => {
    f.pass({ target: surfaceTarget, clear: true }, (fp) => {
      for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
    });
  });
  await gpu.settled();
  return { pixels: (await surfaceTarget.read()) as Uint8Array, component };
}

function rgb(pixels: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 4;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}
const lum = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("GPUDataGrid render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("draws cell chrome across the whole surface", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { pixels, component } = await render(gpu);
    let painted = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) painted++;
    }
    assert.equal(painted, W * H, "every pixel falls inside some cell");
    component.dispose();
  });

  it("alternates zebra striping row by row", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { pixels, component } = await render(gpu);
    // Sample the text column (no conditional formatting there) at each row's centre.
    const rows = [0, 1, 2, 3].map((r) => rgb(pixels, 30, r * 20 + 10));
    assert.notDeepEqual(rows[0], rows[1], "adjacent rows must differ");
    assert.deepEqual(rows[0], rows[2], "every other row matches");
    assert.deepEqual(rows[1], rows[3]);
    component.dispose();
  });

  it("varies conditional formatting with the value, in the numeric column only", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { pixels, component } = await render(gpu);

    // Column 1 (x >= 120) is numeric: score climbs 0..9, so the wash must shift down the column.
    const low = rgb(pixels, 180, 10);
    const high = rgb(pixels, 180, 190);
    assert.notDeepEqual(low, high, "conditional formatting should track the value");
    assert.ok(low[2]! > low[0]!, `low values lean cool/blue, got ${low}`);
    assert.ok(high[0]! > high[2]!, `high values lean warm/red, got ${high}`);

    // The text column at the same rows differs only by zebra, not by value.
    assert.deepEqual(rgb(pixels, 30, 10), rgb(pixels, 30, 50), "text column ignores the value");
    component.dispose();
  });

  it("moves the column rule when scrolled horizontally", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const unscrolled = await render(gpu, 0);
    const scrolled = await render(gpu, 60);

    // The single interior rule sits at x=120 unscrolled, and at x=60 once scrolled by 60px.
    const ruleAt = (pixels: Uint8Array, x: number) => lum(rgb(pixels, x, 100));
    assert.ok(
      ruleAt(unscrolled.pixels, 120) > ruleAt(unscrolled.pixels, 100),
      "an interior column rule should be visible at x=120",
    );
    assert.ok(
      ruleAt(scrolled.pixels, 60) > ruleAt(scrolled.pixels, 40),
      "and should have moved to x=60 after scrolling",
    );

    unscrolled.component.dispose();
    scrolled.component.dispose();
  });
});
