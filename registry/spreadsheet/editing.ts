/**
 * Cell editing and clipboard — CPU/DOM-only, no GPU involvement. `GPUSpreadsheet.tsx` owns the
 * actual `<input>` overlay and wires these to it; kept separate so the edit-session state machine
 * and clipboard parsing are unit-testable without a DOM (§31 open questions 2 and 4).
 */

import type { CellRef } from "./cellRef.ts";
import type { FormulaEngine } from "./formulaEngine.ts";

export interface EditSession {
  readonly cell: CellRef;
  readonly draft: string;
}

/** Starts an edit session. `initial` is what the input should show — the cell's raw formula/value
 * when resuming an existing entry (Enter/double-click), or `""`/the typed character when a
 * keystroke starts a fresh edit (type-to-replace, the common spreadsheet convention). */
export function startEdit(cell: CellRef, initial: string): EditSession {
  return { cell, draft: initial };
}

export function updateDraft(session: EditSession, draft: string): EditSession {
  return { cell: session.cell, draft };
}

/** Commits a session's draft into the engine. Returns the recalculated cell keys, same contract as
 * `FormulaEngine.setCell`. */
export function commitEdit(engine: FormulaEngine, session: EditSession): readonly string[] {
  return engine.setCell(session.cell, session.draft);
}

/** §31 open question 4's default: TSV in, TSV out — matches every real spreadsheet app's clipboard
 * contract, so copy/paste round-trips with external spreadsheet software. */
export function serializeRangeToTSV(
  engine: FormulaEngine,
  topLeft: CellRef,
  rows: number,
  cols: number,
): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(engine.getDisplayText({ row: topLeft.row + r, col: topLeft.col + c }));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Parses pasted text into a 2D array of raw cell inputs, splitting on tabs and newlines. A single
 * value with no delimiters (the common case: copying one cell, or typing into the clipboard) still
 * comes back as a 1×1 grid, so callers don't need a separate scalar-paste path. */
export function parseTSV(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (trimmed === "") return [[""]];
  return trimmed.split("\n").map((line) => line.split("\t"));
}

/** Pastes a parsed TSV grid into the engine starting at `topLeft`, cell by cell. Returns the union
 * of every recalculated cell key across the whole paste, so the caller can flash exactly the cells
 * that changed. */
export function pasteGrid(engine: FormulaEngine, topLeft: CellRef, grid: readonly (readonly string[])[]): readonly string[] {
  const touched = new Set<string>();
  grid.forEach((row, r) => {
    row.forEach((value, c) => {
      const keys = engine.setCell({ row: topLeft.row + r, col: topLeft.col + c }, value);
      for (const k of keys) touched.add(k);
    });
  });
  return [...touched];
}
