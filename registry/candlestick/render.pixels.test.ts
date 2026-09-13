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
import { generateBars, type Bar } from "./ingest.ts";
import { CandlestickComponent, type BarSource } from "./CandlestickComponent.ts";
import { OVERVIEW_BUCKETS } from "./candlestick.wgsl.ts";

/**
 * Real-Dawn verification.
 *
 * Two of these exist because of what this component was built to test. `RingBuffer.overwrite` is new
 * core surface with exactly one caller, and the failure it can have — a write landing at the wrong
 * slot — produces a chart that still looks like a chart. The unit tests only ever check the CPU
 * mirror, so they cannot see it. These assert the colour of specific pixels after a revision and
 * after a wrap, which is the only place the GPU's own addressing is observable.
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

const W = 320;
const H = 240;
const OVERVIEW_H = 40;
const CHART_H = H - OVERVIEW_H;
const PITCH = 32;

const VIEWPORT: ViewportState = {
  timeStart: 0, timeEnd: 1, trackCount: 1, rowStart: 0, rowEnd: 1,
  yContinuous: true, width: W, height: H,
};

/** Body colours from the shader. */
// 8-bit forms of `UP_COLOR` / `DOWN_COLOR` in `candlestick.wgsl.ts`. These must be updated
// together: the assertions below check that a rising bar is drawn in the *up* colour, so a stale
// literal here reports a palette change as a rendering bug.
const UP: [number, number, number] = [14, 124, 88];
const DOWN: [number, number, number] = [192, 43, 43];

const src = (bars: readonly Bar[], version = 1, openBar = false): BarSource => ({ bars, version, openBar });

function bar(over: Partial<Bar> = {}): Bar {
  return { time: 1_800_000_000_000, open: 100, high: 110, low: 90, close: 105, volume: 1000, ...over };
}

async function initDawn(): Promise<Gpu | null> {
  try {
    const { init } = await import("vgpu/node");
    return await init();
  } catch {
    return null;
  }
}

function makeCtx(gpu: Gpu, t: ReturnType<typeof target>): ComponentContext {
  return {
    runtime: { caps: CAPS, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: { surface: t, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps: CAPS,
    onDispose: () => {},
  };
}

/** Mounts once, applies each update in order, then renders — so revisions go through `overwrite`. */
async function render(
  gpu: Gpu,
  capacity: number,
  updates: readonly { source: BarSource; props?: Record<string, unknown> }[],
) {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new CandlestickComponent(capacity);
  component.create(makeCtx(gpu, surfaceTarget));

  for (const step of updates) {
    component.update({
      source: step.source,
      viewport: VIEWPORT,
      pitchPx: PITCH,
      overviewHeightPx: OVERVIEW_H,
      ...step.props,
    });
  }

  const plan = component.plan();
  for (const pass of plan.computePasses) pass.dispatch();
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
function near(a: readonly [number, number, number], b: readonly [number, number, number], tol = 24): boolean {
  return a.every((c, i) => Math.abs(c - b[i]!) <= tol);
}
/**
 * The body colour of the nth visible bar, found by scanning its column.
 *
 * Sampling a fixed y was the first attempt and it was wrong: a body occupies only the open-to-close
 * span, which at some price ranges does not cross the vertical midpoint, so the probe landed on
 * background or on the one-pixel wick and reported "no bar". Scanning the whole column and taking
 * the colour that covers the most pixels finds the body wherever the auto-ranged axis put it, and
 * ignores the wick, which is narrower than the body and therefore not sampled at this x.
 */
function bodyOf(pixels: Uint8Array, index: number): [number, number, number] {
  const x = Math.floor((index + 0.5) * PITCH);
  let up = 0;
  let down = 0;
  for (let y = 0; y < CHART_H; y++) {
    const c = rgb(pixels, x, y);
    if (near(c, UP)) up++;
    else if (near(c, DOWN)) down++;
  }
  if (up === 0 && down === 0) return [0, 0, 0];
  return up >= down ? UP : DOWN;
}
/** Scans a bar's column for any pixel of a body colour, returning its vertical extent. */
function columnExtent(pixels: Uint8Array, index: number): { top: number; bottom: number } | null {
  const x = Math.floor((index + 0.5) * PITCH);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < CHART_H; y++) {
    const c = rgb(pixels, x, y);
    if (near(c, UP) || near(c, DOWN)) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  return top === -1 ? null : { top, bottom };
}

describe("GPUCandlestick render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("colours bodies by direction", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const bars = [
      bar({ open: 100, close: 108 }),  // rising
      bar({ open: 108, close: 96 }),   // falling
      bar({ open: 96, close: 104 }),   // rising
    ];
    const { pixels, component } = await render(gpu, 64, [{ source: src(bars) }]);

    assert.ok(near(bodyOf(pixels, 0), UP), `bar 0 should be green, got ${bodyOf(pixels, 0)}`);
    assert.ok(near(bodyOf(pixels, 1), DOWN), `bar 1 should be red, got ${bodyOf(pixels, 1)}`);
    assert.ok(near(bodyOf(pixels, 2), UP), `bar 2 should be green, got ${bodyOf(pixels, 2)}`);
    component.dispose();
  });

  it("draws the wick above and below the body", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // One bar filling the window, with a long upper wick and a short lower one.
    const bars = [bar({ open: 100, close: 105, high: 130, low: 98 })];
    const { pixels, component } = await render(gpu, 64, [{ source: src(bars) }]);

    const extent = columnExtent(pixels, 0);
    assert.ok(extent, "the bar should be drawn at all");
    // The wick spans the full high-low range, so it reaches nearer the edges than a body would.
    assert.ok(extent!.top < CHART_H * 0.1, `wick should reach the high, top was ${extent!.top}`);
    assert.ok(extent!.bottom > CHART_H * 0.9, `wick should reach the low, bottom was ${extent!.bottom}`);
    component.dispose();
  });

  it("draws a doji as a line rather than letting it vanish", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Open exactly equal to close: a zero-height body, which must still be visible.
    const bars = [bar({ open: 100, close: 100, high: 106, low: 94 })];
    const { pixels, component } = await render(gpu, 64, [{ source: src(bars) }]);
    assert.ok(columnExtent(pixels, 0), "a doji must still render");
    component.dispose();
  });

  it("overwrite lands on the right slot: revising the open bar flips its colour", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Three bars; the newest is rising. A tick then revises *only* that bar to falling.
    const bars = [bar({ open: 100, close: 104 }), bar({ open: 104, close: 108 }), bar({ open: 108, close: 112 })];
    const revised = [...bars];
    revised[2] = bar({ open: 108, close: 99, high: 112, low: 97 });

    const { pixels, component } = await render(gpu, 64, [
      { source: src(bars, 1, true) },
      { source: src(revised, 2, true) },
    ]);

    // If overwrite wrote to the wrong slot, one of the *earlier* bars would have changed colour
    // instead — a chart that still looks entirely plausible.
    assert.ok(near(bodyOf(pixels, 0), UP), `bar 0 must be untouched, got ${bodyOf(pixels, 0)}`);
    assert.ok(near(bodyOf(pixels, 1), UP), `bar 1 must be untouched, got ${bodyOf(pixels, 1)}`);
    assert.ok(near(bodyOf(pixels, 2), DOWN), `bar 2 must now be falling, got ${bodyOf(pixels, 2)}`);
    assert.equal(component.barCount, 3, "revision must not append");
    component.dispose();
  });

  it("overwrite lands on the right slot after the ring has wrapped", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Capacity 4, six bars: head has moved to slot 2, so logical 3 is physical slot 1. This is where
    // an overwrite that forgot to go through slotOf would write to the wrong record.
    const all = [
      bar({ open: 100, close: 104 }), bar({ open: 104, close: 108 }),
      bar({ open: 108, close: 112 }), bar({ open: 112, close: 116 }),
      bar({ open: 116, close: 120 }), bar({ open: 120, close: 124 }),
    ];
    const revised = [...all];
    revised[5] = bar({ open: 120, close: 108, high: 124, low: 106 });

    const { pixels, component } = await render(gpu, 4, [
      { source: src(all, 1, true) },
      { source: src(revised, 2, true) },
    ]);

    assert.equal(component.barCount, 4);
    // Survivors are logical 0..3 = original bars 2..5; only the last is now falling.
    assert.ok(near(bodyOf(pixels, 0), UP), `logical 0 got ${bodyOf(pixels, 0)}`);
    assert.ok(near(bodyOf(pixels, 1), UP), `logical 1 got ${bodyOf(pixels, 1)}`);
    assert.ok(near(bodyOf(pixels, 2), UP), `logical 2 got ${bodyOf(pixels, 2)}`);
    assert.ok(near(bodyOf(pixels, 3), DOWN), `logical 3 should be the revised bar, got ${bodyOf(pixels, 3)}`);
    component.dispose();
  });

  it("panning shows different bars without touching the data", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Alternating direction, so which bar is leftmost is readable from its colour.
    const bars = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0 ? bar({ open: 100, close: 108 }) : bar({ open: 108, close: 100 }),
    );

    const atZero = await render(gpu, 64, [{ source: src(bars) }]);
    assert.ok(near(bodyOf(atZero.pixels, 0), UP), "bar 0 is rising");
    atZero.component.dispose();

    const panned = await render(gpu, 64, [{ source: src(bars), props: { scrollLeftPx: PITCH } }]);
    assert.ok(near(bodyOf(panned.pixels, 0), DOWN), "after one bar of pan, bar 1 is leftmost");
    panned.component.dispose();
  });

  it("reduces the whole-history envelope, matching a CPU oracle", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const bars = generateBars(3000, 1_800_000_000_000);
    const { component } = await render(gpu, 8192, [{ source: src(bars) }]);

    const reading = await component.readOverview();
    assert.ok(reading);

    const expectedLow = Math.min(...bars.map((b) => b.low));
    const expectedHigh = Math.max(...bars.map((b) => b.high));
    const expectedVolume = bars.reduce((n, b) => n + Math.trunc(b.volume), 0);

    // f32 round-trip through the bit pattern is exact for these values, but compare with a relative
    // tolerance rather than asserting identity on floats.
    assert.ok(Math.abs(reading!.lowest - expectedLow) / expectedLow < 1e-5,
      `lowest ${reading!.lowest} vs ${expectedLow}`);
    assert.ok(Math.abs(reading!.highest - expectedHigh) / expectedHigh < 1e-5,
      `highest ${reading!.highest} vs ${expectedHigh}`);

    let volumeTotal = 0;
    for (let i = 0; i < OVERVIEW_BUCKETS; i++) volumeTotal += reading!.buckets[i * 3 + 2]!;
    assert.equal(volumeTotal, expectedVolume, "every bar counted exactly once across the buckets");

    component.dispose();
  });

  it("the envelope covers bars that scrolled out of view entirely", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // The claim the overview exists to make: it summarises history, not the window. Bar 0 holds the
    // only extreme and is far off screen at this scroll position.
    const bars = [bar({ open: 100, close: 101, high: 900, low: 5 })];
    for (let i = 1; i < 500; i++) bars.push(bar({ open: 100, close: 101, high: 102, low: 99 }));

    const { component } = await render(gpu, 1024, [{ source: src(bars), props: { follow: true } }]);
    const reading = await component.readOverview();

    assert.ok(Math.abs(reading!.highest - 900) < 0.1, `history high should be 900, got ${reading!.highest}`);
    assert.ok(Math.abs(reading!.lowest - 5) < 0.1, `history low should be 5, got ${reading!.lowest}`);
    // Meanwhile the visible range excludes it entirely — which is the whole point of having both.
    assert.ok(component.visiblePriceRange.max < 200, "the visible window never saw that bar");

    component.dispose();
  });
});
