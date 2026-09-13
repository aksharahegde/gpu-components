import { rowRange, visibleRows } from "@gpuc/core";
import type { ViewportState } from "@gpuc/core";
import { columnOffset, type SpreadsheetData } from "./ingest.ts";

/**
 * The spreadsheet's text layer — the same Canvas2D-over-GPU-canvas approach
 * `registry/grid/textLayer.ts` uses, and the same budget: `spikes/grid-text-budget.md` measured
 * 2.9ms/frame for 2,400 cells against a glyph atlas that would have been the bigger schedule risk.
 * A spreadsheet viewport is the same order of magnitude (tens of columns × tens of rows), so that
 * measurement is reused rather than re-spiked — see `spikes/spreadsheet-editing-overlay.md` for the
 * genuinely new cost this component adds (the edit overlay, not the text).
 *
 * Right-aligns numeric cells, left-aligns everything else — a spreadsheet convention `GridColumn`
 * needed an explicit `align` prop for; here it falls out of the cell's own value, since any cell
 * can hold either.
 */

export interface SpreadsheetTextTheme {
  readonly font: string;
  readonly headerFont: string;
  readonly color: string;
  readonly errorColor: string;
  readonly headerColor: string;
  readonly headerBackground: string;
  readonly padding: number;
}

export const DEFAULT_THEME: SpreadsheetTextTheme = {
  font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
  headerFont: "600 12px ui-sans-serif, system-ui, sans-serif",
  color: "#1f2430",
  errorColor: "#c02b2b",
  headerColor: "#0d0f14",
  headerBackground: "#f4f5f7",
  padding: 8,
};

export const HEADER_HEIGHT = 28;

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "" : `${text.slice(0, lo)}…`;
}

export interface DrawSpreadsheetTextOptions {
  readonly data: SpreadsheetData;
  readonly viewport: ViewportState;
  readonly scrollX: number;
  readonly dpr: number;
  /** The cell mid-edit, if any — its own text is skipped so the floating `<input>` overlay is the
   * only thing drawing it (no double-render). */
  readonly editingCell?: { readonly row: number; readonly col: number } | null;
  readonly theme?: SpreadsheetTextTheme;
}

export function drawSpreadsheetText(ctx: CanvasRenderingContext2D, opts: DrawSpreadsheetTextOptions): number {
  const { data, viewport, scrollX, dpr, editingCell } = opts;
  const theme = opts.theme ?? DEFAULT_THEME;
  const width = viewport.width;
  const height = viewport.height;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const [rowStart, rowEnd] = rowRange(viewport);
  const rowHeight = height / Math.max(visibleRows(viewport), 1);
  const first = Math.max(0, Math.floor(rowStart));
  const last = Math.min(data.rowCount, Math.ceil(rowEnd));

  const visibleColumns: number[] = [];
  for (let c = 0; c < data.columns.length; c++) {
    const left = columnOffset(data, c) - scrollX;
    if (left + data.columns[c]!.width <= 0 || left >= width) continue;
    visibleColumns.push(c);
  }

  let drawn = 0;
  ctx.textBaseline = "middle";

  for (let r = first; r < last; r++) {
    const y = HEADER_HEIGHT + (r - rowStart) * rowHeight + rowHeight / 2;
    if (y < HEADER_HEIGHT - rowHeight || y > height + rowHeight) continue;
    for (const c of visibleColumns) {
      if (editingCell && editingCell.row === r && editingCell.col === c) continue;
      const column = data.columns[c]!;
      const text = data.text[c]?.[r] ?? "";
      if (!text) continue;
      const error = data.errors[c]?.[r];
      const isNumeric = Number.isFinite(data.numeric[r * data.columns.length + c]);

      ctx.font = theme.font;
      ctx.fillStyle = error ? theme.errorColor : theme.color;

      const left = columnOffset(data, c) - scrollX;
      const inner = column.width - theme.padding * 2;
      const clipped = fit(ctx, text, inner);
      if (!clipped) continue;
      if (isNumeric && !error) {
        ctx.textAlign = "right";
        ctx.fillText(clipped, left + column.width - theme.padding, y);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(clipped, left + theme.padding, y);
      }
      drawn++;
    }
  }

  ctx.fillStyle = theme.headerBackground;
  ctx.fillRect(0, 0, width, HEADER_HEIGHT);
  ctx.font = theme.headerFont;
  ctx.fillStyle = theme.headerColor;
  ctx.textAlign = "left";
  for (const c of visibleColumns) {
    const column = data.columns[c]!;
    const left = columnOffset(data, c) - scrollX;
    const clipped = fit(ctx, column.label, column.width - theme.padding * 2);
    if (!clipped) continue;
    ctx.fillText(clipped, left + theme.padding, HEADER_HEIGHT / 2);
    drawn++;
  }

  ctx.restore();
  return drawn;
}
