import { assertBufferBudget, LineLayer, RasterLayer, packRgba8, rowRange, viewportUniforms, visibleRows } from "@gpuc/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  LineInstance,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpuc/core";
import { storage, uniforms } from "vgpu";
import type { Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { columnAt, columnOffset, totalWidth, type GridData } from "./ingest.ts";
import { GRID_WGSL } from "./grid.wgsl.ts";

export interface GridProps {
  readonly data: GridData;
  /** Rows on the y axis (`rowStart`/`rowEnd`); `width`/`height` are the surface size. */
  readonly viewport: ViewportState;
  /** Horizontal scroll, in CSS pixels from the left edge of the full grid. */
  readonly scrollX: number;
  readonly hoveredRow?: number | null;
  readonly selectedRow?: number | null;
}

interface GridUniforms extends Record<string, unknown> {
  readonly rowCount: number;
  readonly columnCount: number;
  readonly numericColumnCount: number;
  readonly hoveredRow: number;
  readonly selectedRow: number;
  readonly scrollX: number;
  readonly totalWidth: number;
}

/** Cap on drawn rules, matching the axis-rule ceiling in `registry/timeline/axisRules.ts`. */
const MAX_RULES = 256;
const RULE_COLOR = packRgba8(13, 15, 20, 26);

let nextId = 0;

/**
 * `GPUDataGrid` — PLAN.md's flagship (§8.1), built last on purpose.
 *
 * **It is a hybrid, and the split is the whole design.** The GPU draws what is unbounded and
 * data-driven — zebra striping, per-cell conditional formatting evaluated in the fragment shader
 * over the whole column range, hover and selection — as *one* raster pass, because a grid's
 * backgrounds are a field exactly like a heatmap's. Column and row rules come from `LineLayer`.
 * **Cell text is not drawn here at all**: `spikes/grid-text-budget.md` measured a Canvas2D text
 * layer at 2.9ms per frame for 2,400 cells with zero dropped frames, against a glyph atlas that
 * §30 ranked as the phase's largest schedule risk. The wrapper owns that layer.
 *
 * This is also the component §8.1 warned about: its GPU advantage is the weakest of any candidate,
 * because 2,400 visible cells is nothing for either renderer. The honest wins are in the *data*
 * path — conditional formatting over a full column range without a CPU pass, and hover/selection
 * as a uniform write rather than a re-render — and the docs should say exactly that.
 *
 * Not implemented, deliberately (§8.1's "largest correctness surface"): editing, copy/paste, column
 * resize/reorder, RTL and IME. v1 is read-only.
 */
export class GridComponent implements GpuComponent<GridProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private raster: RasterLayer | null = null;
  private rules: LineLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private paramsUniform: SharedUniforms<GridUniforms> | null = null;

  private valuesBuffer: StorageBuffer | null = null;
  private rangesBuffer: StorageBuffer | null = null;
  private offsetsBuffer: StorageBuffer | null = null;
  private numericIndexBuffer: StorageBuffer | null = null;
  private valueCapacity = 0;

  private uploadedData: GridData | null = null;
  private currentViewport: ViewportState | null = null;
  private currentScrollX = 0;
  private hoveredRow = -1;
  private selectedRow = -1;

  constructor() {
    this.id = `grid-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;

    this.raster = new RasterLayer({ gpu: ctx.gpu, shader: GRID_WGSL, label: `${this.id}-cells` });
    this.rules = new LineLayer({
      gpu: ctx.gpu,
      capacity: MAX_RULES,
      label: `${this.id}-rules`,
      warnings: ctx.runtime.warnings,
    });

    this.viewportUniform = uniforms(ctx.gpu!, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.paramsUniform = uniforms(ctx.gpu!, {
      rowCount: 0,
      columnCount: 0,
      numericColumnCount: 0,
      hoveredRow: -1,
      selectedRow: -1,
      scrollX: 0,
      totalWidth: 0,
    });
    this.rules.bindViewport(this.viewportUniform);
    this.raster.bind({ viewport: this.viewportUniform, params: this.paramsUniform });

    // Placeholders so every binding is valid before the first `update()` — the mount-order trap
    // `GPUHeatmap` hit, where the scheduler can tick between `create()` and the first update.
    this.valueCapacity = 0;
    this.allocBuffers(this.uploadedData);

    if (this.uploadedData) this.uploadData(this.uploadedData);
    if (this.currentViewport) this.writeViewport(this.currentViewport);
  }

  /** Allocates (or reallocates) every storage buffer the shader reads, and binds them. */
  private allocBuffers(data: GridData | null): void {
    if (!this.gpu || !this.raster) return;
    const numericColumns = Math.max(1, data ? data.ranges.length : 1);
    const values = Math.max(1, data ? data.rowCount * numericColumns : 1);
    const columns = Math.max(1, data ? data.columns.length : 1);

    this.valueCapacity = values;
    if (this.caps) assertBufferBudget(this.caps, values * 4, "GPUDataGrid values", 4);
    this.valuesBuffer = storage(this.gpu, values * 4, "read");
    this.rangesBuffer = storage(this.gpu, numericColumns * 2 * 4, "read");
    // One extra entry: the prefix sum's final total, so the shader's binary search has an upper
    // bound without a special case.
    this.offsetsBuffer = storage(this.gpu, (columns + 1) * 4, "read");
    this.numericIndexBuffer = storage(this.gpu, columns * 4, "read");

    this.raster.bind({
      values: this.valuesBuffer,
      ranges: this.rangesBuffer,
      columnOffsets: this.offsetsBuffer,
      numericIndex: this.numericIndexBuffer,
    });
  }

  private uploadData(data: GridData): void {
    const numericColumns = Math.max(1, data.ranges.length);
    const needed = data.rowCount * numericColumns;
    if (needed > this.valueCapacity || data.columns.length + 1 > (this.uploadedData?.columns.length ?? 0) + 1) {
      this.allocBuffers(data);
    }

    this.valuesBuffer?.write(data.numeric);

    const ranges = new Float32Array(numericColumns * 2);
    data.ranges.forEach((range, i) => {
      ranges[i * 2] = range[0];
      ranges[i * 2 + 1] = range[1];
    });
    this.rangesBuffer?.write(ranges);

    const offsets = new Float32Array(data.columns.length + 1);
    let running = 0;
    data.columns.forEach((column, i) => {
      offsets[i] = running;
      running += column.width;
    });
    offsets[data.columns.length] = running;
    this.offsetsBuffer?.write(offsets);

    this.numericIndexBuffer?.write(Int32Array.from(data.numericIndex));
  }

  private writeViewport(viewport: ViewportState): void {
    this.viewportUniform?.set(viewportUniforms(viewport));
    const data = this.uploadedData;
    if (!data) return;
    this.paramsUniform?.set({
      rowCount: data.rowCount,
      columnCount: data.columns.length,
      numericColumnCount: Math.max(1, data.ranges.length),
      hoveredRow: this.hoveredRow,
      selectedRow: this.selectedRow,
      scrollX: this.currentScrollX,
      totalWidth: totalWidth(data),
    });
    this.uploadRules(viewport, data);
  }

  /**
   * Column separators and row rules through `LineLayer`. Both families are capped and both drop out
   * when they would be denser than they are useful — the same policy `registry/timeline/axisRules.ts`
   * applies, which is the point of having a shared primitive.
   */
  private uploadRules(viewport: ViewportState, data: GridData): void {
    const lines: LineInstance[] = [];
    const [rowStart, rowEnd] = rowRange(viewport);
    const rowHeightPx = viewport.height / Math.max(visibleRows(viewport), 1);

    // Column separators: x is a pixel offset, so convert to clip directly rather than through the
    // time domain, and span the full height in clip space.
    for (let c = 1; c < data.columns.length && lines.length < MAX_RULES; c++) {
      const px = columnOffset(data, c) - this.currentScrollX;
      if (px < 0 || px > viewport.width) continue;
      const clipX = (px / Math.max(viewport.width, 1)) * 2 - 1;
      lines.push({ x0: clipX, y0: -1, x1: clipX, y1: 1, widthPx: 1, color: RULE_COLOR, flags: 3 });
    }

    // Row rules only when rows are tall enough for a separator to read as structure, not noise.
    if (rowHeightPx >= 12) {
      for (let r = Math.max(1, Math.ceil(rowStart)); r < Math.min(data.rowCount, rowEnd) && lines.length < MAX_RULES; r++) {
        lines.push({ x0: -1, y0: r - 0.5, x1: 1, y1: r - 0.5, widthPx: 1, color: RULE_COLOR, flags: 1 });
      }
    }

    this.rules?.uploadLines(lines);
  }

  update(props: GridProps): void {
    if (props.data !== this.uploadedData) {
      this.uploadedData = props.data;
      this.uploadData(props.data);
    }
    this.currentScrollX = props.scrollX;
    this.hoveredRow = props.hoveredRow ?? -1;
    this.selectedRow = props.selectedRow ?? -1;
    this.currentViewport = props.viewport;
    this.writeViewport(props.viewport);
    this.dirty = true;
  }

  /**
   * Cell hit-testing: a row from the viewport's y mapping, a column from the width prefix sum.
   * Both are arithmetic (the column is a short linear scan over tens of entries), so this is exact
   * and immediate — §9.5's "CPU by default", and the reason the grid needs no picking pass.
   */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    const data = this.uploadedData;
    if (!viewport || !data) return null;

    const [rowStart, rowEnd] = rowRange(viewport);
    const row = Math.floor(rowStart + (y / Math.max(viewport.height, 1)) * (rowEnd - rowStart));
    if (row < 0 || row >= data.rowCount) return null;

    const column = columnAt(data, x + this.currentScrollX);
    if (column < 0) return null;
    return { id: row * data.columns.length + column };
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedData || !this.currentViewport) return { computePasses: [], renderPasses: [] };
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "grid",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.raster?.draw(pass);
            this.rules?.draw(pass);
          },
        },
      ],
    };
  }

  dispose(): void {
    this.raster?.dispose();
    this.rules?.dispose();
  }
}
