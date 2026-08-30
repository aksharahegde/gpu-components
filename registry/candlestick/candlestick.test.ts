import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { target, uniforms, type Gpu } from "vgpu";
import { createMockGpu } from "@gpu-components/testing";
import {
  createWarningsLog, ResourceRegistry,
  type Capabilities, type ComponentContext, type ViewportState,
} from "@gpu-components/core";
import {
  BAR_STRIDE, aggregateTicks, generateBars, packBars, priceRange, validateBars, type Bar,
} from "./ingest.ts";
import { CandlestickComponent, type BarSource } from "./CandlestickComponent.ts";

function makeCtx(gpu: Gpu, t: ReturnType<typeof target>, caps: Capabilities): ComponentContext {
  return {
    runtime: { caps, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: { surface: t, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps,
    onDispose: () => {},
  };
}

const VIEWPORT: ViewportState = {
  timeStart: 0, timeEnd: 1, trackCount: 1, rowStart: 0, rowEnd: 1,
  yContinuous: true, width: 400, height: 246,
};
const PITCH = 8;

const bar = (over: Partial<Bar> = {}): Bar => ({
  time: 1_800_000_000_000, open: 100, high: 110, low: 95, close: 105, volume: 1000, ...over,
});
const src = (bars: readonly Bar[], version = 1, openBar = false): BarSource => ({ bars, version, openBar });

async function mount(capacity = 1024) {
  const { gpu, caps } = await createMockGpu();
  const t = target(gpu, { size: [VIEWPORT.width, VIEWPORT.height] });
  const component = new CandlestickComponent(capacity);
  component.create(makeCtx(gpu, t, caps));
  return { gpu, component };
}

describe("candlestick ingest", () => {
  it("packs six floats per bar at the declared stride", () => {
    const bytes = packBars([bar()], 1_800_000_000_000);
    assert.equal(bytes.byteLength, BAR_STRIDE);
    const v = new DataView(bytes.buffer);
    assert.equal(v.getFloat32(0, true), 0);
    assert.equal(v.getFloat32(4, true), 100);
    assert.equal(v.getFloat32(8, true), 110);
    assert.equal(v.getFloat32(12, true), 95);
    assert.equal(v.getFloat32(16, true), 105);
    assert.equal(v.getFloat32(20, true), 1000);
  });

  it("rejects non-positive prices, because the reduction compares float bit patterns", () => {
    // A negative price would compare as larger than every positive one under atomicMin/Max and
    // silently produce a wrong envelope, so it is refused at the boundary.
    assert.throws(() => validateBars([bar({ low: -1 })]), /must be positive/);
    assert.throws(() => validateBars([bar({ low: 0 })]), /must be positive/);
  });

  it("rejects a bar whose high is below its low", () => {
    assert.throws(() => validateBars([bar({ high: 90, low: 95 })]), /below low/);
  });

  it("computes a visible price range over a slice", () => {
    const bars = [bar({ low: 10, high: 20 }), bar({ low: 5, high: 15 }), bar({ low: 30, high: 40 })];
    assert.deepEqual(priceRange(bars, 0, 2), { min: 5, max: 20 });
    assert.deepEqual(priceRange(bars, 2, 3), { min: 30, max: 40 });
  });

  it("gives a flat series a non-zero range so the transform cannot divide by zero", () => {
    const flat = priceRange([bar({ low: 50, high: 50 })], 0, 1);
    assert.ok(flat.max > flat.min);
  });

  it("returns a usable range for an empty slice", () => {
    const empty = priceRange([], 0, 5);
    assert.ok(empty.max > empty.min);
  });
});

describe("tick aggregation", () => {
  it("extends the open bar rather than appending", () => {
    const bars: Bar[] = [];
    const t0 = 1_800_000_000_000;
    const r1 = aggregateTicks(bars, [{ time: t0, price: 100, size: 5 }], 60_000);
    assert.equal(r1.appended, 1);

    const r2 = aggregateTicks(bars, [
      { time: t0 + 1000, price: 120, size: 3 },
      { time: t0 + 2000, price: 90, size: 2 },
    ], 60_000);
    assert.equal(r2.appended, 0, "same interval, so no new bar");
    assert.ok(r2.updatedLast);

    const only = bars[0]!;
    assert.equal(only.open, 100, "open is the first tick's price and never moves");
    assert.equal(only.high, 120);
    assert.equal(only.low, 90);
    assert.equal(only.close, 90, "close is the latest tick");
    assert.equal(only.volume, 10);
    assert.equal(bars.length, 1);
  });

  it("starts a new bar when the interval rolls over", () => {
    const bars: Bar[] = [];
    const t0 = 1_800_000_000_000;
    aggregateTicks(bars, [{ time: t0, price: 100, size: 1 }], 60_000);
    const r = aggregateTicks(bars, [{ time: t0 + 60_000, price: 101, size: 1 }], 60_000);
    assert.equal(r.appended, 1);
    assert.equal(bars.length, 2);
    assert.equal(bars[1]!.open, 101);
  });

  it("is deterministic for the same seed", () => {
    assert.deepEqual(generateBars(30, 0, 180, 5), generateBars(30, 0, 180, 5));
  });

  it("generates only valid bars", () => {
    assert.doesNotThrow(() => validateBars(generateBars(500, 0)));
  });
});

describe("CandlestickComponent streaming", () => {
  it("appends only new bars", async () => {
    const { gpu, component } = await mount();
    const bars = generateBars(10, 0);
    component.update({ source: src(bars), viewport: VIEWPORT, pitchPx: PITCH });
    assert.equal(component.barCount, 10);

    bars.push(...generateBars(5, 600_000, bars[9]!.close, 77));
    component.update({ source: src(bars, 2), viewport: VIEWPORT, pitchPx: PITCH });
    assert.equal(component.barCount, 15);
    component.dispose();
    gpu.dispose();
  });

  it("revises the open bar in place instead of appending", async () => {
    // The case that made RingBuffer.overwrite necessary — an append-only ring cannot express it.
    const { gpu, component } = await mount();
    const bars = generateBars(5, 0);
    component.update({ source: src(bars, 1, true), viewport: VIEWPORT, pitchPx: PITCH });
    assert.equal(component.barCount, 5);

    const last = bars[4]!;
    bars[4] = { ...last, high: last.high * 1.5, close: last.high * 1.4, volume: last.volume + 500 };
    component.update({ source: src(bars, 2, true), viewport: VIEWPORT, pitchPx: PITCH });

    assert.equal(component.barCount, 5, "revising must not grow the series");
    assert.equal(component.barAt(4)!.high, bars[4]!.high, "the mirror reflects the revision");
    component.dispose();
    gpu.dispose();
  });

  it("evicts the oldest bars past capacity and keeps the mirror the same length", async () => {
    const { gpu, component } = await mount(8);
    const bars = generateBars(20, 0);
    component.update({ source: src(bars), viewport: VIEWPORT, pitchPx: PITCH });

    assert.equal(component.barCount, 8);
    // Index 0 is now the oldest *live* bar, which is the 13th generated.
    assert.equal(component.barAt(0)!.time, bars[12]!.time);
    assert.equal(component.barAt(7)!.time, bars[19]!.time);
    component.dispose();
    gpu.dispose();
  });

  it("ingests a batch far larger than the JS argument limit", async () => {
    // 200,000 bars overflowed the stack in the browser while every test passed, because the tests
    // used 3,000. The engine limit is somewhere around 65,000 arguments, so this is sized past it.
    const { gpu, component } = await mount(300_000);
    const bars = generateBars(150_000, 0);
    component.update({ source: src(bars), viewport: VIEWPORT, pitchPx: PITCH });
    assert.equal(component.barCount, 150_000);
    assert.ok(component.barAt(149_999));
    component.dispose();
    gpu.dispose();
  });

  it("resets on a shorter, different series", async () => {
    const { gpu, component } = await mount();
    component.update({ source: src(generateBars(10, 0)), viewport: VIEWPORT });
    component.update({ source: src(generateBars(3, 0, 50, 4)), viewport: VIEWPORT });
    assert.equal(component.barCount, 3);
    component.dispose();
    gpu.dispose();
  });
});

describe("CandlestickComponent view state", () => {
  it("auto-ranges y to the visible bars only", async () => {
    const { gpu, component } = await mount();
    const bars = [
      bar({ low: 10, high: 20 }), bar({ low: 12, high: 18 }),
      bar({ low: 500, high: 900 }),
    ];
    // Pitch 400 makes exactly one bar visible per screen width.
    component.update({ source: src(bars), viewport: VIEWPORT, pitchPx: 400 });
    const first = component.visiblePriceRange;
    assert.ok(first.max < 100, `expected the far bar excluded, got ${JSON.stringify(first)}`);

    component.update({ source: src(bars), viewport: VIEWPORT, pitchPx: 400, scrollLeftPx: 800 });
    assert.ok(component.visiblePriceRange.max > 800, "scrolled to the tall bar");
    component.dispose();
    gpu.dispose();
  });

  it("zoom is a change to pitch and nothing else", async () => {
    const { gpu, component } = await mount();
    const bars = generateBars(200, 0);
    component.update({ source: src(bars), viewport: VIEWPORT, pitchPx: 4 });
    const wide = component.visiblePriceRange;
    component.update({ source: src(bars), viewport: VIEWPORT, pitchPx: 40 });
    const narrow = component.visiblePriceRange;
    // More bars on screen at pitch 4 means a range at least as wide as at pitch 40.
    assert.ok(wide.max - wide.min >= narrow.max - narrow.min);
    assert.equal(component.barCount, 200, "zoom must not touch the data");
    component.dispose();
    gpu.dispose();
  });

  it("clamps panning to the series and follows the tail", async () => {
    const { gpu, component } = await mount();
    const bars = generateBars(100, 0);
    const base = { source: src(bars), viewport: VIEWPORT, pitchPx: PITCH };

    component.update({ ...base, scrollLeftPx: -100 });
    assert.equal(component.scrollOffsetPx, 0);

    component.update({ ...base, scrollLeftPx: 999_999 });
    assert.equal(component.scrollOffsetPx, 100 * PITCH - VIEWPORT.width);

    component.update({ ...base, follow: true });
    assert.equal(component.scrollOffsetPx, 100 * PITCH - VIEWPORT.width);
    component.dispose();
    gpu.dispose();
  });

  it("hit-tests x to a bar and rejects the overview strip", async () => {
    const { gpu, component } = await mount();
    component.update({ source: src(generateBars(100, 0)), viewport: VIEWPORT, pitchPx: PITCH });

    assert.deepEqual(component.hitTest(0, 10), { id: 0 });
    assert.deepEqual(component.hitTest(PITCH * 3 + 1, 10), { id: 3 });
    // The strip along the bottom is not made of bars.
    assert.equal(component.hitTest(10, VIEWPORT.height - 10), null);
    assert.equal(component.hitTest(-1, 10), null);
    component.dispose();
    gpu.dispose();
  });
});

describe("CandlestickComponent plan", () => {
  it("contributes nothing before data", async () => {
    const { gpu, component } = await mount();
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });

  it("reduces the overview on data change but not on pan", async () => {
    const { gpu, component } = await mount();
    const bars = generateBars(100, 0);
    const base = { source: src(bars), viewport: VIEWPORT, pitchPx: PITCH };

    component.update(base);
    assert.equal(component.plan().computePasses.length, 1);

    component.update({ ...base, scrollLeftPx: 120 });
    assert.equal(component.plan().computePasses.length, 0, "panning must not re-reduce");

    bars.push(...generateBars(2, 9_000_000, bars[99]!.close, 3));
    component.update({ ...base, source: src(bars, 2) });
    assert.equal(component.plan().computePasses.length, 1);
    component.dispose();
    gpu.dispose();
  });

  it("draws candles and the overview in one pass", async () => {
    const { gpu, component } = await mount();
    component.update({ source: src(generateBars(50, 0)), viewport: VIEWPORT, pitchPx: PITCH });
    const plan = component.plan();
    assert.equal(plan.renderPasses.length, 1);
    component.dispose();
    gpu.dispose();
  });
});
