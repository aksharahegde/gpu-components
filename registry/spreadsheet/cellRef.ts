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

const CELL_REF_RE = /^([A-Za-z]+)(\d+)$/;

/** Parses `"A1"` → `{ col: 0, row: 0 }`. Returns `null` for anything that isn't a bare cell ref. */
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

/** Parses `"A1:B10"` → a normalised range (start is the top-left, end the bottom-right). */
export function parseRange(text: string): CellRange | null {
  const parts = text.trim().split(":");
  if (parts.length !== 2) return null;
  const a = parseCellRef(parts[0]!);
  const b = parseCellRef(parts[1]!);
  if (!a || !b) return null;
  return {
    start: { col: Math.min(a.col, b.col), row: Math.min(a.row, b.row) },
    end: { col: Math.max(a.col, b.col), row: Math.max(a.row, b.row) },
  };
}

export function formatRange(range: CellRange): string {
  return `${formatCellRef(range.start)}:${formatCellRef(range.end)}`;
}

/** Every cell ref covered by a range, row-major. Callers on a hot path should stream instead of
 * materialising this for large ranges — kept simple because v1's ranges are bounded (§31 open
 * question 3, the recalculation ceiling). */
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
