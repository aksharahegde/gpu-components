import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import { createMockGpu, createRecordingContext2D } from "@gpuc/testing";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type ComponentContext,
} from "@gpuc/core";
import { columnAt, columnOffset, computeColumnRanges, ingestRows, totalWidth, type GridColumn } from "./ingest.ts";
import { GridComponent } from "./GridComponent.ts";
import { drawGridText, HEADER_HEIGHT } from "./textLayer.ts";

const COLUMNS: GridColumn[] = [
  { key: "name", label: "Name", width: 160 },
  { key: "qty", label: "Qty", width: 80, numeric: true, align: "right" },
  { key: "price", label: "Price", width: 100, numeric: true, align: "right" },
];

const ROWS = Array.from({ length: 50 }, (_, i) => ({
  name: `item-${i}`,
  qty: i,
  price: i * 1.5,
}));

const DATA = ingestRows(ROWS, COLUMNS);

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>): ComponentContext {
  return {
    runtime: { caps: NO_WEBGPU_CAPABILITIES, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: { surface: surfaceTarget, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps: NO_WEBGPU_CAPABILITIES,
    onDispose: () => {},
  };
}

describe("ingestRows", () => {
  it("splits numeric and text columns, keeping display text for both", () => {
    assert.equal(DATA.rowCount, 50);
    // 2 numeric columns -> 2 values per row.
    assert.equal(DATA.numeric.length, 50 * 2);
    assert.deepEqual(DATA.numericIndex, [-1, 0, 1]);
    assert.equal(DATA.text[0]![3], "item-3");
    assert.equal(DATA.text[1]![3], "3", "numeric columns still carry formatted text");
  });

  it("treats a missing or non-numeric value as a hole, not as zero", () => {
    const data = ingestRows([{ name: "a" }, { name: "b", qty: 5 }], COLUMNS);
    assert.ok(Number.isNaN(data.numeric[0]), "missing numeric should be NaN, not 0");
    assert.equal(data.text[1]![0], "", "and should render as empty rather than '0'");
    assert.equal(data.text[1]![1], "5");
  });

  it("computes per-column ranges, skipping holes", () => {
    const ranges = computeColumnRanges(Float32Array.from([1, 10, Number.NaN, 20, 3, 30]), 3, 2);
    assert.deepEqual(ranges[0], [1, 3]);
    assert.deepEqual(ranges[1], [10, 30]);
  });

  it("widens a constant column so conditional formatting never divides by zero", () => {
    const [lo, hi] = computeColumnRanges(Float32Array.from([7, 7, 7]), 3, 1)[0]!;
    assert.ok(hi > lo);
  });
});

describe("column geometry", () => {
  it("computes offsets and total width from the column list", () => {
    assert.equal(totalWidth(DATA), 340);
    assert.equal(columnOffset(DATA, 0), 0);
    assert.equal(columnOffset(DATA, 2), 240);
  });

  it("finds the column at a pixel offset, and reports -1 past the end", () => {
    assert.equal(columnAt(DATA, 0), 0);
    assert.equal(columnAt(DATA, 159), 0);
    assert.equal(columnAt(DATA, 160), 1);
    assert.equal(columnAt(DATA, 339), 2);
    assert.equal(columnAt(DATA, 340), -1);
  });
});

describe("GridComponent", () => {
  const viewport = { timeStart: 0, timeEnd: 1, trackCount: 50, rowStart: 0, rowEnd: 20, width: 340, height: 400 };

  it("runs create/update/plan/dispose against a mock Gpu", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

    const component = new GridComponent();
    component.create(ctx);
    component.update({ data: DATA, viewport, scrollX: 0 });

    const plan = component.plan();
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.computePasses.length, 0, "the grid's work is all per-pixel, no dispatches");

    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("contributes nothing when a frame lands before the first update", async () => {
    // The mount-order trap `GPUHeatmap` hit, guarded here from the start.
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GridComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });

  it("hit-tests a cell from the row range and the column prefix sum", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GridComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: DATA, viewport, scrollX: 0 });

    // 20 visible rows over 400px = 20px per row. y=10 -> row 0; y=50 -> row 2.
    assert.deepEqual(component.hitTest(10, 10), { id: 0 });
    assert.deepEqual(component.hitTest(10, 50), { id: 2 * 3 });
    // x=200 falls in column 1 (160..240).
    assert.deepEqual(component.hitTest(200, 10), { id: 1 });
    assert.equal(component.hitTest(500, 10), null, "past the last column");

    component.dispose();
    gpu.dispose();
  });

  it("accounts for horizontal scroll in hit-testing", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GridComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: DATA, viewport, scrollX: 160 });

    // Scrolled one column: screen x=10 is now inside column 1.
    assert.deepEqual(component.hitTest(10, 10), { id: 1 });

    component.dispose();
    gpu.dispose();
  });

  it("hit-tests against the scrolled row range, not the dataset", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new GridComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ data: DATA, viewport: { ...viewport, rowStart: 10, rowEnd: 30 }, scrollX: 0 });

    assert.deepEqual(component.hitTest(10, 10), { id: 10 * 3 }, "the first visible row is row 10");

    component.dispose();
    gpu.dispose();
  });
});

describe("Canvas2D text layer (the spike's verdict, applied)", () => {
  const viewport = { timeStart: 0, timeEnd: 1, trackCount: 50, rowStart: 0, rowEnd: 10, width: 340, height: 300 };

  it("draws a header cell per column plus a cell per visible row", () => {
    const recorder = createRecordingContext2D();
    const drawn = drawGridText(recorder.ctx, { data: DATA, viewport, scrollX: 0, dpr: 1 });
    // 10 visible rows x 3 columns + 3 headers.
    assert.equal(drawn, 33);
  });

  it("virtualises horizontally — a scrolled-off column costs nothing", () => {
    const recorder = createRecordingContext2D();
    // Scroll past the first two columns entirely; only the third remains on screen.
    const narrow = { ...viewport, width: 60 };
    const drawn = drawGridText(recorder.ctx, { data: DATA, viewport: narrow, scrollX: 240, dpr: 1 });
    assert.equal(drawn, 10 + 1, "one column's cells plus its header");
  });

  it("skips empty cells rather than painting blanks", () => {
    const sparse = ingestRows([{ name: "only" }, {}], COLUMNS);
    const recorder = createRecordingContext2D();
    const drawn = drawGridText(recorder.ctx, {
      data: sparse,
      viewport: { ...viewport, trackCount: 2, rowStart: 0, rowEnd: 2 },
      scrollX: 0,
      dpr: 1,
    });
    // Only "only" plus 3 headers — every other cell is empty.
    assert.equal(drawn, 4);
  });

  it("reserves the header strip above the rows", () => {
    assert.ok(HEADER_HEIGHT > 0);
    const recorder = createRecordingContext2D();
    drawGridText(recorder.ctx, { data: DATA, viewport, scrollX: 0, dpr: 1 });
    assert.ok(recorder.calls.length > 0, "the recorder should see fillRect for the header background");
  });
});
