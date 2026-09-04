import { assertBufferBudget, LineLayer, RasterLayer, packRgba8, rowRange, viewportUniforms, visibleRows } from "@gpu-components/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  LineInstance,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpu-components/core";
import { storage, uniforms } from "vgpu";
import type { Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { type CellRange, cellKey, keyToCellRef } from "./cellRef.ts";
import { columnAt, columnOffset, totalWidth, type SpreadsheetData } from "./ingest.ts";
import { MAX_FLASH_CELLS, SPREADSHEET_WGSL } from "./spreadsheet.wgsl.ts";

export interface FlashCell {
  readonly row: number;
  readonly col: number;
  /** 0–1, current opacity. Decay is the React wrapper's job (`GPUSpreadsheet.tsx`'s rAF loop) —
   * this component only ever renders whatever alpha it's handed, per frame, per §5.2's "small-N,
   * branchy, stays off the GPU": deciding *when* a flash has faded is timer bookkeeping for a
   * handful of cells, not a data-parallel job. */
  readonly alpha: number;
}

export interface SpreadsheetProps {
  readonly data: SpreadsheetData;
  readonly viewport: ViewportState;
  readonly scrollX: number;
  readonly hoveredCell?: { readonly row: number; readonly col: number } | null;
  /** A rectangular multi-cell selection — the spreadsheet analogue of `GridProps.selectedRow`. */
  readonly selection?: CellRange | null;
  readonly flashCells?: readonly FlashCell[];
}

interface SheetUniforms extends Record<string, unknown> {
  readonly rowCount: number;
  readonly columnCount: number;
  readonly hoveredRow: number;
  readonly hoveredCol: number;
  readonly selRowStart: number;
  readonly selRowEnd: number;
  readonly selColStart: number;
  readonly selColEnd: number;
  readonly scrollX: number;
  readonly totalWidth: number;
  readonly rangeLo: number;
  readonly rangeHi: number;
  readonly flashCount: number;
  readonly _pad0: number;
  readonly _pad1: number;
  readonly _pad2: number;
}

/** Cap on drawn row/column rules — same ceiling `registry/grid/grid.wgsl.ts`'s LineLayer uses. */
const MAX_RULES = 256;
const RULE_COLOR = packRgba8(255, 255, 255, 20);
const EMPTY_SELECTION: CellRange = { start: { row: -1, col: -1 }, end: { row: -1, col: -1 } };

let nextId = 0;

/**
 * `SpreadsheetComponent` — the GPU half of `GPUSpreadsheet` (plan §"Architecture", "GPU layer").
 *
 * Nearly identical to `GridComponent`: one `RasterLayer` pass for cell chrome, one `LineLayer` pass
 * for row/column rules. New relative to the grid: a rectangular multi-cell selection instead of a
 * single selected row, and a dirty-cell flash buffer. Both are uniform/storage writes, never a
 * per-frame data re-walk — the same gate every other component in this runtime is held to (§5).
 *
 * Cell text (formula results, formatted) is drawn by `textLayer.ts` over this surface, exactly like
 * the grid's — see that file's docstring for the measured budget this reuses.
 */
export class SpreadsheetComponent implements GpuComponent<SpreadsheetProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private raster: RasterLayer | null = null;
  private rules: LineLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private paramsUniform: SharedUniforms<SheetUniforms> | null = null;

  private valuesBuffer: StorageBuffer | null = null;
  private offsetsBuffer: StorageBuffer | null = null;
  private flashCellsBuffer: StorageBuffer | null = null;
  private flashAlphasBuffer: StorageBuffer | null = null;
  private cellCapacity = 0;
  private columnCapacity = 0;

  private uploadedData: SpreadsheetData | null = null;
  private currentViewport: ViewportState | null = null;
  private currentScrollX = 0;
  private hoveredCell: { row: number; col: number } | null = null;
  private selection: CellRange = EMPTY_SELECTION;
  private flashCells: readonly FlashCell[] = [];

  constructor() {
    this.id = `spreadsheet-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;

    this.raster = new RasterLayer({ gpu: ctx.gpu, shader: SPREADSHEET_WGSL, label: `${this.id}-cells` });
    this.rules = new LineLayer({
      gpu: ctx.gpu,
      capacity: MAX_RULES,
      label: `${this.id}-rules`,
      warnings: ctx.runtime.warnings,
    });

    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.paramsUniform = uniforms(ctx.gpu, {
      rowCount: 0,
      columnCount: 0,
      hoveredRow: -1,
      hoveredCol: -1,
      selRowStart: -1,
      selRowEnd: -1,
      selColStart: -1,
      selColEnd: -1,
      scrollX: 0,
      totalWidth: 0,
      rangeLo: 0,
      rangeHi: 1,
      flashCount: 0,
      _pad0: 0,
      _pad1: 0,
      _pad2: 0,
    });
    this.rules.bindViewport(this.viewportUniform);
    this.raster.bind({ viewport: this.viewportUniform, params: this.paramsUniform });

    this.cellCapacity = 0;
    this.columnCapacity = 0;
    this.allocBuffers(this.uploadedData);

    if (this.uploadedData) this.uploadData(this.uploadedData);
    if (this.currentViewport) this.writeViewport(this.currentViewport);
  }

  private allocBuffers(data: SpreadsheetData | null): void {
    if (!this.gpu || !this.raster) return;
    const rowCount = Math.max(1, data ? data.rowCount : 1);
    const colCount = Math.max(1, data ? data.columns.length : 1);
    const cells = rowCount * colCount;

    this.cellCapacity = cells;
    this.columnCapacity = colCount;
    if (this.caps) assertBufferBudget(this.caps, cells * 4, "GPUSpreadsheet values", 4);
    this.valuesBuffer = storage(this.gpu, cells * 4, "read");
    this.offsetsBuffer = storage(this.gpu, (colCount + 1) * 4, "read");
    this.flashCellsBuffer = storage(this.gpu, MAX_FLASH_CELLS * 4, "read");
    this.flashAlphasBuffer = storage(this.gpu, MAX_FLASH_CELLS * 4, "read");

    this.raster.bind({
      values: this.valuesBuffer,
      columnOffsets: this.offsetsBuffer,
      flashCells: this.flashCellsBuffer,
      flashAlphas: this.flashAlphasBuffer,
    });
  }

  private uploadData(data: SpreadsheetData): void {
    const needed = data.rowCount * data.columns.length;
    if (needed > this.cellCapacity || data.columns.length + 1 > this.columnCapacity + 1) {
      this.allocBuffers(data);
    }
    this.valuesBuffer?.write(data.numeric);

    const offsets = new Float32Array(data.columns.length + 1);
    let running = 0;
    data.columns.forEach((column, i) => {
      offsets[i] = running;
      running += column.width;
    });
    offsets[data.columns.length] = running;
    this.offsetsBuffer?.write(offsets);
  }

  private uploadFlash(): void {
    const cells = new Uint32Array(MAX_FLASH_CELLS);
    const alphas = new Float32Array(MAX_FLASH_CELLS);
    const count = Math.min(this.flashCells.length, MAX_FLASH_CELLS);
    for (let i = 0; i < count; i++) {
      const f = this.flashCells[i]!;
      cells[i] = ((f.row & 0xffff) << 16) | (f.col & 0xffff);
      alphas[i] = f.alpha;
    }
    this.flashCellsBuffer?.write(cells);
    this.flashAlphasBuffer?.write(alphas);
  }

  private writeViewport(viewport: ViewportState): void {
    this.viewportUniform?.set(viewportUniforms(viewport));
    const data = this.uploadedData;
    if (!data) return;
    this.paramsUniform?.set({
      rowCount: data.rowCount,
      columnCount: data.columns.length,
      hoveredRow: this.hoveredCell?.row ?? -1,
      hoveredCol: this.hoveredCell?.col ?? -1,
      selRowStart: this.selection.start.row,
      selRowEnd: this.selection.end.row,
      selColStart: this.selection.start.col,
      selColEnd: this.selection.end.col,
      scrollX: this.currentScrollX,
      totalWidth: totalWidth(data),
      rangeLo: data.range[0],
      rangeHi: data.range[1],
      flashCount: Math.min(this.flashCells.length, MAX_FLASH_CELLS),
      _pad0: 0,
      _pad1: 0,
      _pad2: 0,
    });
    this.uploadRules(viewport, data);
  }

  private uploadRules(viewport: ViewportState, data: SpreadsheetData): void {
    const lines: LineInstance[] = [];
    const [rowStart, rowEnd] = rowRange(viewport);
    const rowHeightPx = viewport.height / Math.max(visibleRows(viewport), 1);

    for (let c = 1; c < data.columns.length && lines.length < MAX_RULES; c++) {
      const px = columnOffset(data, c) - this.currentScrollX;
      if (px < 0 || px > viewport.width) continue;
      const clipX = (px / Math.max(viewport.width, 1)) * 2 - 1;
      lines.push({ x0: clipX, y0: -1, x1: clipX, y1: 1, widthPx: 1, color: RULE_COLOR, flags: 3 });
    }

    if (rowHeightPx >= 12) {
      for (let r = Math.max(1, Math.ceil(rowStart)); r < Math.min(data.rowCount, rowEnd) && lines.length < MAX_RULES; r++) {
        lines.push({ x0: -1, y0: r - 0.5, x1: 1, y1: r - 0.5, widthPx: 1, color: RULE_COLOR, flags: 1 });
      }
    }

    this.rules?.uploadLines(lines);
  }

  update(props: SpreadsheetProps): void {
    if (props.data !== this.uploadedData) {
      this.uploadedData = props.data;
      this.uploadData(props.data);
    }
    this.currentScrollX = props.scrollX;
    this.hoveredCell = props.hoveredCell ?? null;
    this.selection = props.selection ?? EMPTY_SELECTION;
    this.flashCells = props.flashCells ?? [];
    this.currentViewport = props.viewport;
    this.uploadFlash();
    this.writeViewport(props.viewport);
    this.dirty = true;
  }

  /** Cell hit-testing, exact and immediate — same arithmetic split as `GridComponent`'s (§9.5). */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    const data = this.uploadedData;
    if (!viewport || !data) return null;

    const [rowStart, rowEnd] = rowRange(viewport);
    const row = Math.floor(rowStart + (y / Math.max(viewport.height, 1)) * (rowEnd - rowStart));
    if (row < 0 || row >= data.rowCount) return null;

    const column = columnAt(data, x + this.currentScrollX);
    if (column < 0) return null;
    return { id: cellKey({ row, col: column }) };
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedData || !this.currentViewport) return { computePasses: [], renderPasses: [] };
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "spreadsheet",
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

/** Decodes a `hitTest` id back into a cell ref — the counterpart to `SpreadsheetComponent`'s
 * `cellKey`-shaped `HitResult.id`. */
export function hitResultToCell(id: string | number): { row: number; col: number } {
  return keyToCellRef(String(id));
}
