/**
 * `GPUSpreadsheet`'s rendering data model — the same "shaped to be a renderer" discipline
 * `registry/grid/ingest.ts` states, extended with an editable, formula-derived value layer instead
 * of one ingested once. `SpreadsheetComponent`/`spreadsheet.wgsl.ts` read only `numeric`/`ranges`
 * (for conditional formatting); `textLayer.ts` reads `text`; neither ever sees `formulas` — that
 * stays CPU-side in `FormulaEngine`, per PLAN.md §5.2.
 *
 * **One range for the whole sheet, not one per column.** `GridData` computes a `[min, max]` per
 * *numeric column*, because its columns are typed — a column is numeric or it isn't. A spreadsheet
 * cell's type is a property of the cell, not the column: `A1` might hold a number and `A2` text.
 * So conditional formatting here works the way `GPUHeatmap`'s does — one field, one range — rather
 * than the grid's per-column indirection, which doesn't generalise to untyped columns.
 */

import { columnIndexToLetters, formatCellRef, type CellRef } from "./cellRef.ts";
import { type CellErrorCode, type CellValue, FormulaEngine } from "./formulaEngine.ts";

export interface SpreadsheetColumn {
  readonly key: string;
  readonly label: string;
  /** Width in CSS pixels — layout, kept on the CPU per §5.2. */
  readonly width: number;
}

export interface SpreadsheetData {
  readonly columns: readonly SpreadsheetColumn[];
  readonly rowCount: number;
  /** Row-major, `rowCount × columns.length`. `NaN` marks "not a number" (text, error, or empty) —
   * the raster shader leaves those cells uncoloured, the same convention `GridData.numeric` uses. */
  readonly numeric: Float32Array<ArrayBuffer>;
  /** `text[col][row]` — the *displayed* value: a formula's result, formatted, or an error code. */
  readonly text: readonly (readonly string[])[];
  /** Single sheet-wide `[min, max]` over every finite numeric cell — see the module doc above. */
  readonly range: readonly [number, number];
  /** `errors[col][row]`, `null` when the cell has no error. */
  readonly errors: readonly (readonly (CellErrorCode | null)[])[];
}

/** Default column width and count for a freshly created sheet — callers can override per column. */
export function defaultColumns(count: number, width = 96): SpreadsheetColumn[] {
  return Array.from({ length: count }, (_, i) => ({
    key: columnIndexToLetters(i),
    label: columnIndexToLetters(i),
    width,
  }));
}

/**
 * Builds `SpreadsheetData` from a `FormulaEngine`'s current state for a bounded `rowCount ×
 * columns.length` window. Called after every edit — cheap relative to the recalculation it follows,
 * since it's one linear pass over the (bounded) visible-model grid, not the whole engine.
 */
export function buildSpreadsheetData(
  engine: FormulaEngine,
  columns: readonly SpreadsheetColumn[],
  rowCount: number,
): SpreadsheetData {
  const colCount = columns.length;
  const numeric = new Float32Array(new ArrayBuffer(rowCount * colCount * 4));
  const text: string[][] = Array.from({ length: colCount }, () => new Array(rowCount).fill(""));
  const errors: (CellErrorCode | null)[][] = Array.from({ length: colCount }, () => new Array(rowCount).fill(null));

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      const ref: CellRef = { row, col };
      const value = engine.getValue(ref);
      const error = engine.getError(ref);
      const idx = row * colCount + col;

      errors[col]![row] = error;
      text[col]![row] = engine.getDisplayText(ref);

      const n = typeof value === "number" ? value : Number.NaN;
      numeric[idx] = n;
      if (Number.isFinite(n)) {
        if (n < min) min = n;
        if (n > max) max = n;
      }
    }
  }

  const range: readonly [number, number] = min > max ? [0, 1] : min === max ? [min, min + 1] : [min, max];

  return { columns, rowCount, numeric, text, range, errors };
}

/** Total width of all columns, in CSS pixels. Mirrors `registry/grid/ingest.ts`. */
export function totalWidth(data: Pick<SpreadsheetData, "columns">): number {
  let total = 0;
  for (const column of data.columns) total += column.width;
  return total;
}

export function columnOffset(data: Pick<SpreadsheetData, "columns">, index: number): number {
  let offset = 0;
  for (let c = 0; c < index && c < data.columns.length; c++) offset += data.columns[c]!.width;
  return offset;
}

export function columnAt(data: Pick<SpreadsheetData, "columns">, x: number): number {
  let offset = 0;
  for (let c = 0; c < data.columns.length; c++) {
    const next = offset + data.columns[c]!.width;
    if (x >= offset && x < next) return c;
    offset = next;
  }
  return -1;
}

/** A human-readable one-line description of a cell — for the a11y live region and hover tooltips,
 * mirroring `describeRow` in `registry/grid/GPUDataGrid.tsx`. */
export function describeCell(engine: FormulaEngine, ref: CellRef): string {
  const error = engine.getError(ref);
  const label = formatCellRef(ref);
  if (error) return `${label}: error, ${error}`;
  const raw = engine.getRaw(ref);
  const display = engine.getDisplayText(ref);
  if (raw.startsWith("=")) return `${label}: ${display}, formula ${raw}`;
  return `${label}: ${display || "empty"}`;
}

export type { CellValue };
