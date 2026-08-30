import { rowRange, visibleRows } from "@gpu-components/core";
import type { ViewportState } from "@gpu-components/core";
import { columnOffset, type GridData } from "./ingest.ts";

/**
 * The grid's text layer: a Canvas2D surface drawn *over* the GPU canvas.
 *
 * This is the direct product of `spikes/grid-text-budget.md`. §13.4 had assumed the DataGrid would
 * force a GPU glyph atlas — the largest schedule risk in Phase 5 (§30 risk 2). Measurement said
 * otherwise: at the 2,400-cell reference a Canvas2D text layer costs **2.9ms p50 / 3.6ms worst with
 * zero dropped frames**, inside a 16.6ms budget with ~4.5x headroom, while a DOM overlay drops
 * every frame past ~1,200 nodes. So the grid draws text the way glide-data-grid does, and the atlas
 * becomes an optimisation nobody currently needs.
 *
 * Redrawn on data or viewport change rather than every frame — the grid's content is static between
 * scrolls, which is damage-based repaint in the sense §4.3 credits glide-data-grid for.
 *
 * **The cost of this choice, stated where the code makes it:** canvas text is not selectable and not
 * copyable, and §21.2 makes selectable label text an accessibility requirement. `GPUDataGrid.tsx`
 * answers that with a real DOM overlay for the focused row plus `toAccessibleTable()`; this layer is
 * for the other ~2,399 cells, which no assistive technology was ever going to read one at a time.
 */

export interface TextLayerTheme {
  readonly font: string;
  readonly headerFont: string;
  readonly color: string;
  readonly headerColor: string;
  readonly headerBackground: string;
  readonly padding: number;
}

export const DEFAULT_THEME: TextLayerTheme = {
  font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
  headerFont: "600 12px ui-sans-serif, system-ui, sans-serif",
  color: "#d7dbe4",
  headerColor: "#e7e9ee",
  headerBackground: "#0d0f13",
  padding: 8,
};

export const HEADER_HEIGHT = 28;

/** Truncates with an ellipsis to fit `maxWidth`, measuring against the live context. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  // Binary search the cut point: measureText is the expensive call, so do log2(n) of them, not n.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "" : `${text.slice(0, lo)}…`;
}

export interface DrawTextOptions {
  readonly data: GridData;
  readonly viewport: ViewportState;
  readonly scrollX: number;
  readonly dpr: number;
  readonly theme?: TextLayerTheme;
}

/**
 * Draws the header row and every visible cell's text. Returns how many cells were drawn, which the
 * caller can surface through `onPerformance` — the spike's budget is only meaningful if the
 * component can say when it exceeds it.
 */
export function drawGridText(ctx: CanvasRenderingContext2D, opts: DrawTextOptions): number {
  const { data, viewport, scrollX, dpr } = opts;
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

  // Only the columns actually on screen — the horizontal half of virtualisation, and the reason
  // this stays inside budget on a grid far wider than the viewport.
  const visibleColumns: number[] = [];
  for (let c = 0; c < data.columns.length; c++) {
    const left = columnOffset(data, c) - scrollX;
    // Half-open: a column whose right edge lands exactly on x=0, or whose left edge lands exactly
    // on the surface width, occupies zero visible pixels and must not be drawn.
    if (left + data.columns[c]!.width <= 0 || left >= width) continue;
    visibleColumns.push(c);
  }

  let drawn = 0;
  ctx.textBaseline = "middle";
  ctx.font = theme.font;
  ctx.fillStyle = theme.color;

  for (let r = first; r < last; r++) {
    const y = HEADER_HEIGHT + (r - rowStart) * rowHeight + rowHeight / 2;
    if (y < HEADER_HEIGHT - rowHeight || y > height + rowHeight) continue;
    for (const c of visibleColumns) {
      const column = data.columns[c]!;
      const text = data.text[c]?.[r] ?? "";
      if (!text) continue;
      const left = columnOffset(data, c) - scrollX;
      const inner = column.width - theme.padding * 2;
      const clipped = fit(ctx, text, inner);
      if (!clipped) continue;
      if (column.align === "right") {
        ctx.textAlign = "right";
        ctx.fillText(clipped, left + column.width - theme.padding, y);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(clipped, left + theme.padding, y);
      }
      drawn++;
    }
  }

  // Header last so it paints over any row that scrolled beneath it.
  ctx.fillStyle = theme.headerBackground;
  ctx.fillRect(0, 0, width, HEADER_HEIGHT);
  ctx.font = theme.headerFont;
  ctx.fillStyle = theme.headerColor;
  for (const c of visibleColumns) {
    const column = data.columns[c]!;
    const left = columnOffset(data, c) - scrollX;
    const clipped = fit(ctx, column.label, column.width - theme.padding * 2);
    if (!clipped) continue;
    if (column.align === "right") {
      ctx.textAlign = "right";
      ctx.fillText(clipped, left + column.width - theme.padding, HEADER_HEIGHT / 2);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(clipped, left + theme.padding, HEADER_HEIGHT / 2);
    }
    drawn++;
  }

  ctx.restore();
  return drawn;
}
