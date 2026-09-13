import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { target, uniforms, type Gpu } from "vgpu";
import { createMockGpu } from "@gpuc/testing";
import {
  createWarningsLog,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type Capabilities,
  type ComponentContext,
  type ViewportState,
} from "@gpuc/core";
import {
  LOG_RECORD_STRIDE,
  formatLogLine,
  generateLogLines,
  levelIndex,
  lineMatches,
  matchRanges,
  packLogRecords,
  type LogLine,
} from "./ingest.ts";
import { LogViewerComponent, type LogSource } from "./LogViewerComponent.ts";

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>, caps: Capabilities): ComponentContext {
  return {
    runtime: { caps, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: { surface: surfaceTarget, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps,
    onDispose: () => {},
  };
}

const VIEWPORT: ViewportState = {
  timeStart: 0, timeEnd: 1, trackCount: 1,
  rowStart: 0, rowEnd: 1, yContinuous: true,
  width: 600, height: 150,
};

const LINE_HEIGHT = 15;

function line(i: number, over: Partial<LogLine> = {}): LogLine {
  return {
    timestamp: 1_800_000_000_000 + i * 1000,
    level: "info",
    logger: "db.pool",
    message: `message ${i}`,
    ...over,
  };
}

function source(lines: readonly LogLine[], version = 1): LogSource {
  return { lines, version };
}

async function mount(capacity = 64) {
  const { gpu, caps } = await createMockGpu();
  const surfaceTarget = target(gpu, { size: [VIEWPORT.width, VIEWPORT.height] });
  const component = new LogViewerComponent(capacity);
  component.create(makeCtx(gpu, surfaceTarget, caps));
  return { gpu, component };
}

describe("log ingest", () => {
  it("packs records at the declared stride", () => {
    const bytes = packLogRecords([line(0), line(1, { level: "error" })], 1_800_000_000_000);
    assert.equal(bytes.byteLength, 2 * LOG_RECORD_STRIDE);
    const view = new DataView(bytes.buffer);
    assert.equal(view.getFloat32(0, true), 0);
    assert.equal(view.getFloat32(LOG_RECORD_STRIDE, true), 1, "one second later");
    assert.equal(view.getUint32(LOG_RECORD_STRIDE + 4, true), levelIndex("error"));
  });

  it("keeps millisecond resolution by storing time relative to an epoch", () => {
    // Absolute epoch ms in f32 quantises to ~131s steps, which would make every line in a session
    // land on the same timestamp. This is the assertion that would fail if that regressed.
    const epoch = 1_800_000_000_000;
    const bytes = packLogRecords([{ ...line(0), timestamp: epoch + 7 }], epoch);
    // Compared with a tolerance because 0.007 is not exactly representable in f32; the claim under
    // test is that 7ms survives at all, not that it round-trips bit-for-bit.
    assert.ok(Math.abs(new DataView(bytes.buffer).getFloat32(0, true) - 0.007) < 1e-6);
  });

  it("formats a line with recoverable field positions", () => {
    const text = formatLogLine(line(0, { level: "warn", logger: "auth", message: "hi" }));
    // The text layer slices by position rather than re-parsing, so these offsets are load-bearing.
    assert.equal(text.slice(0, 12).length, 12);
    assert.equal(text.slice(14, 19), "WARN ");
    assert.ok(text.endsWith("auth  hi"));
  });

  it("matches on logger and message, honouring case and level filters", () => {
    const l = line(0, { level: "error", logger: "db.pool", message: "Timed out" });
    assert.ok(lineMatches(l, { text: "timed" }));
    assert.ok(!lineMatches(l, { text: "timed", caseSensitive: true }));
    assert.ok(lineMatches(l, { text: "db.pool" }));
    assert.ok(!lineMatches(l, { text: "", levels: ["info"] }));
    assert.ok(lineMatches(l, { text: "", levels: ["error"] }));
    assert.ok(lineMatches(l, { text: "" }), "an empty query matches everything");
  });

  it("finds every match range, including repeats", () => {
    assert.deepEqual(matchRanges("aXbXc", "x"), [[1, 2], [3, 4]]);
    assert.deepEqual(matchRanges("aXbXc", "x", true), []);
    assert.deepEqual(matchRanges("abc", ""), []);
  });

  it("generates deterministic sample data", () => {
    const a = generateLogLines(50, 0, 7);
    const b = generateLogLines(50, 0, 7);
    assert.deepEqual(a, b);
    assert.equal(a.length, 50);
  });
});

describe("LogViewerComponent streaming", () => {
  it("appends only the tail it has not consumed", async () => {
    const { gpu, component } = await mount();
    const lines = [line(0), line(1), line(2)];
    component.update({ source: source(lines), viewport: VIEWPORT, lineHeight: LINE_HEIGHT });
    assert.equal(component.lineCount, 3);

    // The host appends in place and bumps the version — the whole point of LogSource.
    lines.push(line(3), line(4));
    component.update({ source: source(lines, 2), viewport: VIEWPORT, lineHeight: LINE_HEIGHT });
    assert.equal(component.lineCount, 5);

    // No growth without new lines.
    component.update({ source: source(lines, 3), viewport: VIEWPORT, lineHeight: LINE_HEIGHT });
    assert.equal(component.lineCount, 5);

    component.dispose();
    gpu.dispose();
  });

  it("evicts the oldest lines once the ring is full", async () => {
    const { gpu, component } = await mount(4);
    const lines = Array.from({ length: 6 }, (_, i) => line(i));
    component.update({ source: source(lines), viewport: VIEWPORT, lineHeight: LINE_HEIGHT });

    assert.equal(component.lineCount, 4, "capacity, not the number appended");
    const visible = component.visibleLines();
    // Logical 0 is now the oldest *live* line, which is the third one appended.
    assert.match(visible[0]!.text, /message 2/);
    assert.match(visible[3]!.text, /message 5/);

    component.dispose();
    gpu.dispose();
  });

  it("keeps the CPU mirror aligned with the ring across a wrap", async () => {
    const { gpu, component } = await mount(4);
    const lines: LogLine[] = [];
    // Append in uneven batches so the wrap lands mid-batch rather than on a slot boundary.
    for (const batch of [3, 3, 2, 5]) {
      for (let i = 0; i < batch; i++) lines.push(line(lines.length));
      component.update({ source: source(lines, lines.length), viewport: VIEWPORT, lineHeight: LINE_HEIGHT });
    }
    const visible = component.visibleLines();
    assert.equal(visible.length, 4);
    // 13 lines appended into 4 slots: the survivors are 9..12, in order.
    assert.deepEqual(visible.map((v) => v.text.match(/message (\d+)/)![1]), ["9", "10", "11", "12"]);

    component.dispose();
    gpu.dispose();
  });

  it("resets when handed a shorter, different stream", async () => {
    const { gpu, component } = await mount();
    component.update({ source: source([line(0), line(1), line(2)]), viewport: VIEWPORT });
    assert.equal(component.lineCount, 3);

    component.update({ source: source([line(99)]), viewport: VIEWPORT });
    assert.equal(component.lineCount, 1);
    assert.match(component.visibleLines()[0]!.text, /message 99/);

    component.dispose();
    gpu.dispose();
  });
});

describe("LogViewerComponent view state", () => {
  it("virtualises: visible lines are the window, not the buffer", async () => {
    const { gpu, component } = await mount(4096);
    const lines = generateLogLines(4000, 0);
    component.update({ source: source(lines), viewport: VIEWPORT, lineHeight: LINE_HEIGHT });

    // A 150px window at 15px lines shows 10, plus one partial row.
    assert.ok(component.visibleLines().length <= 11, "window, not buffer");
    assert.equal(component.lineCount, 4000);

    component.dispose();
    gpu.dispose();
  });

  it("scrolls by logical line, clamped to the content", async () => {
    const { gpu, component } = await mount(4096);
    const lines = generateLogLines(100, 0);
    const base = { source: source(lines), viewport: VIEWPORT, lineHeight: LINE_HEIGHT };

    component.update({ ...base, scrollTopPx: 15 * 20 });
    assert.equal(component.visibleLines()[0]!.logical, 20);

    // Past the end clamps to the last full window rather than scrolling into blank space.
    component.update({ ...base, scrollTopPx: 999_999 });
    assert.equal(component.scrollOffsetPx, 100 * 15 - VIEWPORT.height);

    component.update({ ...base, scrollTopPx: -50 });
    assert.equal(component.scrollOffsetPx, 0);

    component.dispose();
    gpu.dispose();
  });

  it("follow mode pins to the tail as lines arrive", async () => {
    const { gpu, component } = await mount(4096);
    const lines = generateLogLines(100, 0);
    component.update({ source: source(lines), viewport: VIEWPORT, lineHeight: LINE_HEIGHT, follow: true });
    const first = component.scrollOffsetPx;

    lines.push(...generateLogLines(10, 0, 9));
    component.update({ source: source(lines, 2), viewport: VIEWPORT, lineHeight: LINE_HEIGHT, follow: true });
    assert.equal(component.scrollOffsetPx, first + 10 * LINE_HEIGHT, "stayed at the tail");

    component.dispose();
    gpu.dispose();
  });

  it("marks matches without dropping unmatched lines", async () => {
    const { gpu, component } = await mount();
    const lines = [
      line(0, { message: "cache miss" }),
      line(1, { message: "connection ok" }),
      line(2, { message: "cache hit" }),
    ];
    component.update({ source: source(lines), viewport: VIEWPORT, query: { text: "cache" } });

    const visible = component.visibleLines();
    assert.equal(visible.length, 3, "filtering is emphasis, not removal — context stays on screen");
    assert.deepEqual(visible.map((v) => v.matched), [true, false, true]);

    component.dispose();
    gpu.dispose();
  });

  it("hit-tests a pixel to a logical line, accounting for scroll", async () => {
    const { gpu, component } = await mount(4096);
    const lines = generateLogLines(100, 0);
    component.update({
      source: source(lines), viewport: VIEWPORT, lineHeight: LINE_HEIGHT, scrollTopPx: 15 * 20,
    });

    assert.deepEqual(component.hitTest(10, 0), { id: 20 });
    assert.deepEqual(component.hitTest(10, 16), { id: 21 });
    assert.equal(component.hitTest(10, -5), null);
    assert.equal(component.hitTest(-5, 10), null);

    component.dispose();
    gpu.dispose();
  });
});

describe("LogViewerComponent plan", () => {
  it("contributes nothing before any data arrives", async () => {
    const { gpu, component } = await mount();
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });

  it("runs the minimap reduction on data and query change, not on scroll", async () => {
    const { gpu, component } = await mount(4096);
    const lines = generateLogLines(200, 0);
    const base = { source: source(lines), viewport: VIEWPORT, lineHeight: LINE_HEIGHT };

    component.update(base);
    assert.equal(component.plan().computePasses.length, 1, "new data");

    component.update({ ...base, scrollTopPx: 300 });
    assert.equal(component.plan().computePasses.length, 0, "scrolling must not re-reduce");

    component.update({ ...base, query: { text: "pool" } });
    assert.equal(component.plan().computePasses.length, 1, "new query");

    lines.push(line(999));
    component.update({ ...base, source: source(lines, 2), query: { text: "pool" } });
    assert.equal(component.plan().computePasses.length, 1, "new lines");

    component.dispose();
    gpu.dispose();
  });

  it("draws rows and the minimap in one pass", async () => {
    const { gpu, component } = await mount(4096);
    component.update({ source: source(generateLogLines(50, 0)), viewport: VIEWPORT });
    const plan = component.plan();
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.renderPasses[0]!.clear, true);
    component.dispose();
    gpu.dispose();
  });
});
