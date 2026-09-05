/**
 * A1-notation cell references — shared by `ingest.ts`, `formulaParser.ts`, and `formulaEngine.ts`.
 *
 * Split out from `ingest.ts` because the formula engine needs these with no dependency on the
 * `SpreadsheetData` rendering shape, and the parser needs them with no dependency on the engine.
 */

export interface CellRef {
  readonly row: number;
  readonly col: number;
}

export interface CellRange {
  readonly start: CellRef;
  readonly end: CellRef;
}

/** Bijective base-26: 0 → "A", 25 → "Z", 26 → "AA" — the same scheme spreadsheet column letters use. */
export function columnIndexToLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function lettersToColumnIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Real-spreadsheet-shaped bounds on a single cell reference — not a parser implementation detail,
 * these are re-exported so callers (and tests) can reason about the ceiling directly. */
export const MAX_COLUMN_LETTERS = 3; // up to "ZZZ" = 18,277 columns
export const MAX_ROW_DIGITS = 7; // up to 9,999,999 rows

/** Every cell a single range may cover — the DoS ceiling. `parseRange` enforces this; nothing else
 * in this module does (see `rangeRefs`'s doc below). 2^20, matching a real spreadsheet's row limit. */
export const MAX_RANGE_CELLS = 1_048_576;

// Bounded per `MAX_COLUMN_LETTERS`/`MAX_ROW_DIGITS` above — an unbounded `+` here is what let
// `parseCellRef("ZZZZZZ1")` produce a column index in the hundreds of millions and feed straight
// into an unbounded range expansion.
const CELL_REF_RE = /^([A-Za-z]{1,3})(\d{1,7})$/;

/** Parses `"A1"` → `{ col: 0, row: 0 }`. Returns `null` for anything that isn't a bare cell ref,
 * including one that overruns `MAX_COLUMN_LETTERS`/`MAX_ROW_DIGITS` — callers already treat `null`
 * as "not a valid ref", so an over-long ref degrading to `null` needs no separate handling. */
export function parseCellRef(text: string): CellRef | null {
  const m = CELL_REF_RE.exec(text.trim());
  if (!m) return null;
  const row = Number.parseInt(m[2]!, 10) - 1;
  if (row < 0) return null;
  return { col: lettersToColumnIndex(m[1]!.toUpperCase()), row };
}

export function formatCellRef(ref: CellRef): string {
  return `${columnIndexToLetters(ref.col)}${ref.row + 1}`;
}

/** Parses `"A1:B10"` → a normalised range (start is the top-left, end the bottom-right). Returns
 * `null` if either endpoint is invalid, or if the normalised range covers more than
 * `MAX_RANGE_CELLS` cells — this is the sole bound on range size; a formula referencing an
 * oversized range never reaches `rangeRefs`/`collectRefs`, so it can't blow up the dependency Set
 * or the recalculation loop. `formulaParser.ts` already treats a `null` range as a parse error
 * (`FormulaParseError`), which `FormulaEngine.setCell` already turns into a clean `#NAME?` cell
 * error — so an oversized range degrades the same way an invalid one always has. */
export function parseRange(text: string): CellRange | null {
  const parts = text.trim().split(":");
  if (parts.length !== 2) return null;
  const a = parseCellRef(parts[0]!);
  const b = parseCellRef(parts[1]!);
  if (!a || !b) return null;
  const start = { col: Math.min(a.col, b.col), row: Math.min(a.row, b.row) };
  const end = { col: Math.max(a.col, b.col), row: Math.max(a.row, b.row) };
  const cellCount = (end.row - start.row + 1) * (end.col - start.col + 1);
  if (cellCount > MAX_RANGE_CELLS) return null;
  return { start, end };
}

export function formatRange(range: CellRange): string {
  return `${formatCellRef(range.start)}:${formatCellRef(range.end)}`;
}

/** Every cell ref covered by a range, row-major. Callers on a hot path should stream instead of
 * materialising this for large ranges. Ranges are now bounded by `MAX_RANGE_CELLS` in `parseRange`
 * above (the previous claim here — "v1's ranges are bounded" — was false and was the root cause of
 * a DoS: nothing actually enforced it). `rangeRefs` itself stays unbounded: it has no way to know
 * how a `CellRange` was constructed, so any future caller that builds one directly (not via
 * `parseRange`) is responsible for its own bounding before calling this. */
export function* rangeRefs(range: CellRange): Generator<CellRef> {
  for (let row = range.start.row; row <= range.end.row; row++) {
    for (let col = range.start.col; col <= range.end.col; col++) {
      yield { col, row };
    }
  }
}

/** A stable Map key for a cell ref — cheaper than an object identity or a formatted string in the
 * dependency graph's hot path. */
export function cellKey(ref: CellRef): string {
  return `${ref.col},${ref.row}`;
}

export function keyToCellRef(key: string): CellRef {
  const [col, row] = key.split(",");
  return { col: Number(col), row: Number(row) };
}
