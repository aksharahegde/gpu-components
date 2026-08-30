/**
 * `GPUDataGrid`'s data model (PLAN.md §29 Phase 5, §8.1).
 *
 * **Shaped to be a renderer, not a table.** §4.3 is explicit: "A GPUDataGrid should ideally be a
 * TanStack Table renderer, not a Table replacement." So this holds only what *drawing* needs —
 * already-ordered rows, already-resolved columns — and owns no sorting, filtering, grouping or
 * pagination. A TanStack `getRowModel()` result maps onto `GridData` directly; the adapter that
 * does that mapping is the next step and is deliberately not this file's job.
 *
 * Values are split by kind rather than boxed: numeric columns go into one `Float32Array` matrix so
 * the GPU can read them for conditional formatting, and text columns stay as strings on the CPU
 * because §5.2 puts all string handling there, permanently.
 */

export type ColumnAlign = "left" | "right";

export interface GridColumn {
  readonly key: string;
  readonly label: string;
  /** Width in CSS pixels. Column widths are layout, which §5.2 keeps on the CPU. */
  readonly width: number;
  readonly align?: ColumnAlign;
  /**
   * Numeric columns participate in conditional formatting: the GPU colours each cell by where its
   * value falls in that column's range. Text columns render as text only.
   */
  readonly numeric?: boolean;
}

export interface GridData {
  readonly columns: readonly GridColumn[];
  readonly rowCount: number;
  /**
   * Row-major numeric values, `rowCount × numericColumnCount`, in the order numeric columns appear
   * in `columns`. Non-finite marks "no value" and is left uncoloured.
   */
  readonly numeric: Float32Array;
  /** `text[columnIndex][rowIndex]`, only for columns without `numeric: true`. */
  readonly text: readonly (readonly string[])[];
  /** Per-numeric-column `[min, max]`, computed once at ingest — see `computeColumnRanges`. */
  readonly ranges: readonly (readonly [number, number])[];
  /** Index into `numeric`'s columns for each entry of `columns`, or -1 for text columns. */
  readonly numericIndex: readonly number[];
}

export interface RawRow {
  readonly [key: string]: number | string | null | undefined;
}

/**
 * Per-column min/max for conditional formatting.
 *
 * On the CPU deliberately. A grid has tens of columns, not millions, so this is small-N work that
 * §5.2 keeps off the GPU — unlike `GPUHeatmap`, whose single range is over millions of cells and
 * therefore earns a reduction kernel. Same project, opposite answer, for a reason worth stating:
 * "put reductions on the GPU" is not a rule, it is a consequence of N.
 */
export function computeColumnRanges(
  numeric: Float32Array,
  rowCount: number,
  numericColumnCount: number,
): (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = [];
  for (let c = 0; c < numericColumnCount; c++) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let r = 0; r < rowCount; r++) {
      const v = numeric[r * numericColumnCount + c]!;
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ranges.push(min > max ? [0, 1] : min === max ? [min, min + 1] : [min, max]);
  }
  return ranges;
}

/** Builds `GridData` from plain row objects — the ergonomic path (§17.1). */
export function ingestRows(rows: readonly RawRow[], columns: readonly GridColumn[]): GridData {
  const numericIndex: number[] = [];
  let numericColumnCount = 0;
  for (const column of columns) {
    numericIndex.push(column.numeric ? numericColumnCount++ : -1);
  }

  const rowCount = rows.length;
  const numeric = new Float32Array(rowCount * Math.max(1, numericColumnCount));
  const text: string[][] = columns.map(() => []);

  for (let r = 0; r < rowCount; r++) {
    const row = rows[r]!;
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c]!;
      const raw = row[column.key];
      if (column.numeric) {
        const value = typeof raw === "number" ? raw : Number.NaN;
        numeric[r * numericColumnCount + numericIndex[c]!] = value;
        // Numeric columns still need display text, and formatting a number is string work: CPU.
        text[c]![r] = Number.isFinite(value) ? formatNumber(value) : "";
      } else {
        text[c]![r] = raw == null ? "" : String(raw);
      }
    }
  }

  return {
    columns,
    rowCount,
    numeric,
    text,
    ranges: computeColumnRanges(numeric, rowCount, Math.max(1, numericColumnCount)),
    numericIndex,
  };
}

/** Compact default formatting. Replaceable — this file is copied into the consuming repo (§18). */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Total width of all columns, in CSS pixels — the grid's horizontal extent. */
export function totalWidth(data: GridData): number {
  let total = 0;
  for (const column of data.columns) total += column.width;
  return total;
}

/** The x pixel offset of a column's left edge, within the full (unscrolled) grid. */
export function columnOffset(data: GridData, index: number): number {
  let offset = 0;
  for (let c = 0; c < index && c < data.columns.length; c++) offset += data.columns[c]!.width;
  return offset;
}

/** The column index at a pixel offset within the full grid, or -1. */
export function columnAt(data: GridData, x: number): number {
  let offset = 0;
  for (let c = 0; c < data.columns.length; c++) {
    const next = offset + data.columns[c]!.width;
    if (x >= offset && x < next) return c;
    offset = next;
  }
  return -1;
}
