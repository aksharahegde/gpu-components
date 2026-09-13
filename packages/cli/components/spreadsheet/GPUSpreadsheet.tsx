import { createPointerController, createViewportController, normalizeWheel, rowRange } from "@gpuc/core";
import type { ViewportBounds, ViewportState } from "@gpuc/core";
import { SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpuc/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { type CellRange, type CellRef, formatCellRef } from "./cellRef.ts";
import { type EditSession, commitEdit, parseTSV, pasteGrid, serializeRangeToTSV, startEdit, updateDraft } from "./editing.ts";
import { FormulaEngine } from "./formulaEngine.ts";
import { buildSpreadsheetData, columnOffset, defaultColumns, describeCell, totalWidth, type SpreadsheetColumn, type SpreadsheetData } from "./ingest.ts";
import { type FlashCell, SpreadsheetComponent } from "./SpreadsheetComponent.ts";
import { drawSpreadsheetText, HEADER_HEIGHT } from "./textLayer.ts";

const WHEEL_ROWS = 3;
const MAX_A11Y_ROWS = 30;
/** Flash fade duration — long enough to read as feedback, short enough not to linger over a fast
 * typist's next few edits. Not spiked (§31 open question in the plan is about editing latency, not
 * this cosmetic detail); revisit if it ever needs to be measured. */
const FLASH_DURATION_MS = 500;

export interface GPUSpreadsheetProps {
  readonly rowCount: number;
  readonly columns?: readonly SpreadsheetColumn[];
  /** Initial cell contents, e.g. `{ "A1": "1", "B1": "=A1*2" }` — uncontrolled after mount, edits
   * live in the internal `FormulaEngine`. There is no controlled-value prop in v1: a spreadsheet's
   * state (formulas, dependency graph) doesn't round-trip through a plain props diff the way a
   * read-only grid's data does. */
  readonly initialCells?: Readonly<Record<string, string>>;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly scrollX?: number;
  readonly onScrollXChange?: (x: number) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

interface FlashEntry {
  readonly row: number;
  readonly col: number;
  readonly startedAt: number;
}

function normalizedSelection(a: CellRef, b: CellRef): CellRange {
  return {
    start: { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) },
    end: { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) },
  };
}

/**
 * `GPUSpreadsheet` — editable, formula-driven (plan §"Architecture").
 *
 * Structurally `GPUDataGrid` plus three things that component explicitly deferred: an edit overlay,
 * a rectangular selection, and clipboard. Cell values come from `FormulaEngine`, not props — see
 * `GPUSpreadsheetProps.initialCells`'s note on why this component is uncontrolled.
 */
export function GPUSpreadsheet(props: GPUSpreadsheetProps): JSX.Element {
  const { rowCount, onViewportChange, onScrollXChange, style, className } = props;
  const columns = useMemo(() => props.columns ?? defaultColumns(12), [props.columns]);
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const engineRef = useRef<FormulaEngine | null>(null);
  if (!engineRef.current) engineRef.current = new FormulaEngine();
  const engine = engineRef.current;

  const [dataVersion, setDataVersion] = useState(0);
  const data: SpreadsheetData = useMemo(
    () => buildSpreadsheetData(engine, columns, rowCount),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dataVersion` is the intentional
    // recompute trigger; `engine` is a stable ref and would never itself change.
    [columns, rowCount, dataVersion],
  );

  useEffect(() => {
    if (!props.initialCells) return;
    // `initialCells` is external input — a document someone else authored, passed across a public
    // prop boundary. `engine.setCell` is designed to never throw, but this loop runs inside an
    // effect with no error boundary above it: one bad entry throwing here would unmount the whole
    // React root (blank page, no user interaction required), so it gets its own belt-and-braces
    // guard. A cell that can't be set is skipped, not fatal to the rest of the seed.
    for (const [a1, raw] of Object.entries(props.initialCells)) {
      try {
        const ref = a1ToRef(a1);
        if (ref) engine.setCell(ref, raw);
      } catch {
        // Skip this cell; the rest of `initialCells` should still seed.
      }
    }
    setDataVersion((v) => v + 1);
    // Seed once on mount only — this is not a controlled-value sync (see the props doc above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const [internalScrollX, setInternalScrollX] = useState(props.scrollX ?? 0);
  const scrollX = onScrollXChange ? (props.scrollX ?? 0) : internalScrollX;

  const [hoveredCell, setHoveredCell] = useState<CellRef | null>(null);
  const [anchorCell, setAnchorCell] = useState<CellRef | null>(null);
  const [activeCell, setActiveCell] = useState<CellRef | null>(null);
  const [selection, setSelection] = useState<CellRange | null>(null);
  const [edit, setEdit] = useState<EditSession | null>(null);
  const [flashes, setFlashes] = useState<readonly FlashEntry[]>([]);
  const draggingRef = useRef(false);

  const bounds: ViewportBounds = useMemo(
    () => ({ timeMin: 0, timeMax: 1, rowMin: 0, rowMax: rowCount }),
    [rowCount],
  );
  const maxScrollX = Math.max(0, totalWidth(data) - viewport.width);

  const [visibleRowStart, visibleRowEnd] = rowRange(viewport);
  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Spreadsheet",
    summary:
      `${data.rowCount} rows, ${data.columns.length} columns. ` +
      `Showing rows ${Math.floor(visibleRowStart)} to ${Math.ceil(visibleRowEnd)}.`,
  });

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const scrollXRef = useRef(scrollX);
  scrollXRef.current = scrollX;

  const setViewport = useCallback(
    (next: ViewportState) => {
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    },
    [onViewportChange],
  );
  const setScrollX = useCallback(
    (next: number) => {
      if (onScrollXChange) onScrollXChange(next);
      else setInternalScrollX(next);
    },
    [onScrollXChange],
  );
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;
  const setScrollXRef = useRef(setScrollX);
  setScrollXRef.current = setScrollX;

  const componentRef = useRef<SpreadsheetComponent | null>(null);
  const factory = useCallback(() => {
    const component = new SpreadsheetComponent();
    componentRef.current = component;
    return component;
  }, []);

  const bodyViewport = useMemo(
    () => ({ ...viewport, height: Math.max(1, viewport.height - HEADER_HEIGHT) }),
    [viewport],
  );

  /** Current flash alpha per cell, linearly faded — computed each render from wall-clock elapsed
   * time; the rAF loop below just forces enough re-renders for the fade to be visible. */
  const flashCells: FlashCell[] = useMemo(() => {
    const now = performance.now();
    return flashes
      .map((f) => ({ row: f.row, col: f.col, alpha: Math.max(0, 1 - (now - f.startedAt) / FLASH_DURATION_MS) }))
      .filter((f) => f.alpha > 0);
  }, [flashes]);

  useEffect(() => {
    if (flashes.length === 0) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      setFlashes((prev) => {
        const next = prev.filter((f) => now - f.startedAt < FLASH_DURATION_MS);
        return next.length === prev.length ? prev : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flashes.length > 0]);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({
        data,
        viewport: bodyViewport,
        scrollX,
        hoveredCell,
        selection,
        flashCells,
      }),
      [data, bodyViewport, scrollX, hoveredCell, selection, flashCells],
    ),
  );

  useEffect(() => {
    const el = textCanvasRef.current;
    if (!el) return;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    el.width = Math.round(viewport.width * dpr);
    el.height = Math.round(viewport.height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    drawSpreadsheetText(ctx, { data, viewport: bodyViewport, scrollX, dpr, editingCell: edit?.cell ?? null });
  }, [data, viewport, bodyViewport, scrollX, edit]);

  const commitCurrentEdit = useCallback(() => {
    if (!edit) return;
    const touched = commitEdit(engine, edit);
    setFlashes((prev) => [...prev, ...touched.map((k) => ({ ...keyToRowCol(k), startedAt: performance.now() }))]);
    setDataVersion((v) => v + 1);
    setEdit(null);
  }, [edit, engine]);

  const beginEdit = useCallback(
    (cell: CellRef, initial?: string) => {
      const value = initial ?? engine.getRaw(cell);
      setEdit(startEdit(cell, value));
    },
    [engine],
  );

  const moveActive = useCallback(
    (next: CellRef, extend: boolean) => {
      const clamped: CellRef = {
        row: Math.max(0, Math.min(rowCount - 1, next.row)),
        col: Math.max(0, Math.min(columns.length - 1, next.col)),
      };
      setActiveCell(clamped);
      if (extend && anchorCell) {
        setSelection(normalizedSelection(anchorCell, clamped));
      } else {
        setAnchorCell(clamped);
        setSelection({ start: clamped, end: clamped });
      }
      a11y.announce(describeCell(engine, clamped));

      const [rowStart, rowEnd] = rowRange(viewport);
      if (clamped.row < rowStart || clamped.row >= rowEnd) {
        const span = rowEnd - rowStart;
        const start = Math.max(0, Math.min(rowCount - span, clamped.row < rowStart ? clamped.row : clamped.row - span + 1));
        setViewport({ ...viewport, rowStart: start, rowEnd: start + span });
      }
      const left = columnOffset(data, clamped.col);
      const right = left + (data.columns[clamped.col]?.width ?? 0);
      if (left < scrollX) setScrollX(Math.max(0, left));
      else if (right > scrollX + viewport.width) setScrollX(Math.min(maxScrollX, right - viewport.width));
    },
    [rowCount, columns.length, anchorCell, viewport, data, scrollX, maxScrollX, engine, a11y, setViewport, setScrollX],
  );

  useEffect(() => {
    const el = canvas;
    if (!el) return;
    const pointer = createPointerController();
    const detach = pointer.attach(el);

    const cellAt = (x: number, y: number): CellRef | null => {
      const component = componentRef.current;
      const hit = component?.hitTest(x, y) ?? null;
      if (!hit) return null;
      const [col, row] = String(hit.id).split(",").map(Number);
      return { row: row!, col: col! };
    };

    const unsubMove = pointer.onMove((state) => {
      const cell = cellAt(state.x, state.y);
      setHoveredCell(cell);
      if (draggingRef.current && cell && anchorCell) {
        setSelection(normalizedSelection(anchorCell, cell));
        setActiveCell(cell);
      }
    });
    const unsubLeave = pointer.onLeave(() => setHoveredCell(null));
    const unsubDown = pointer.onDown((state) => {
      const cell = cellAt(state.x, state.y);
      if (!cell) return;
      if (edit) commitCurrentEdit();
      // A click lands on the canvas, a sibling of the div that owns `onKeyDown` — the browser
      // never moves focus there on its own, so without this, arrow keys and typing do nothing
      // until the user Tabs in first. For an editable grid (unlike the read-only `GPUDataGrid`,
      // where click-then-type isn't a workflow at all) that's not an acceptable gap.
      containerRef.current?.focus();
      draggingRef.current = true;
      setActiveCell(cell);
      setAnchorCell(cell);
      setSelection({ start: cell, end: cell });
    });
    const unsubUp = pointer.onUp(() => {
      draggingRef.current = false;
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { deltaX, deltaY } = normalizeWheel(e);
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        setScrollXRef.current(Math.max(0, Math.min(maxScrollX, scrollXRef.current + deltaX)));
        return;
      }
      const v = viewportRef.current;
      const controller = createViewportController({ ...v, height: Math.max(1, v.height - HEADER_HEIGHT) }, bounds);
      const rowsPerPixel = (v.rowEnd ?? rowCount) - (v.rowStart ?? 0);
      const pixels = (deltaY / 100) * WHEEL_ROWS * (v.height / Math.max(rowsPerPixel, 1));
      controller.panByPixels(0, pixels);
      const next = controller.getState();
      setViewportRef.current({ ...v, rowStart: next.rowStart, rowEnd: next.rowEnd });
    };

    const onDoubleClick = (e: MouseEvent) => {
      // `el` is the raster canvas, already positioned `top: HEADER_HEIGHT` below the header band —
      // its own bounding rect starts at the body, so this needs no further header adjustment (the
      // pointer-controller callbacks above get the same already-body-relative coordinates).
      const rect = el.getBoundingClientRect();
      const cell = cellAt(e.clientX - rect.left, e.clientY - rect.top);
      if (cell) beginEdit(cell);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDoubleClick);
    return () => {
      unsubMove();
      unsubLeave();
      unsubDown();
      unsubUp();
      detach();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDoubleClick);
    };
  }, [canvas, anchorCell, edit, commitCurrentEdit, beginEdit, bounds, maxScrollX, rowCount]);

  // Depends on `edit?.cell`, not `edit` — `updateDraft` reuses the same `cell` reference for every
  // keystroke within one session, so this only re-fires when a *new* edit session starts. Keying it
  // on the whole `edit` object would re-select on every keystroke (a new object each time draft
  // changes), which replaces whatever was just typed with itself on the next character.
  useEffect(() => {
    const el = inputRef.current;
    if (edit && el) {
      el.focus();
      el.select();
    }
  }, [edit?.cell]);

  const onCopy = useCallback(
    (e: React.ClipboardEvent) => {
      if (!selection) return;
      e.preventDefault();
      const rows = selection.end.row - selection.start.row + 1;
      const cols = selection.end.col - selection.start.col + 1;
      e.clipboardData.setData("text/plain", serializeRangeToTSV(engine, selection.start, rows, cols));
    },
    [engine, selection],
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!activeCell) return;
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const touched = pasteGrid(engine, activeCell, parseTSV(text));
      setFlashes((prev) => [...prev, ...touched.map((k) => ({ ...keyToRowCol(k), startedAt: performance.now() }))]);
      setDataVersion((v) => v + 1);
    },
    [engine, activeCell],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (edit) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitCurrentEdit();
          if (activeCell) moveActive({ row: activeCell.row + 1, col: activeCell.col }, false);
        } else if (e.key === "Tab") {
          e.preventDefault();
          commitCurrentEdit();
          if (activeCell) moveActive({ row: activeCell.row, col: activeCell.col + (e.shiftKey ? -1 : 1) }, false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          setEdit(null);
        }
        return;
      }

      if (!activeCell) return;
      const extend = e.shiftKey;
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); moveActive({ row: activeCell.row + 1, col: activeCell.col }, extend); return;
        case "ArrowUp": e.preventDefault(); moveActive({ row: activeCell.row - 1, col: activeCell.col }, extend); return;
        case "ArrowLeft": e.preventDefault(); moveActive({ row: activeCell.row, col: activeCell.col - 1 }, extend); return;
        case "ArrowRight": e.preventDefault(); moveActive({ row: activeCell.row, col: activeCell.col + 1 }, extend); return;
        case "Tab": e.preventDefault(); moveActive({ row: activeCell.row, col: activeCell.col + (e.shiftKey ? -1 : 1) }, false); return;
        case "Enter": e.preventDefault(); beginEdit(activeCell); return;
        case "Delete":
        case "Backspace": {
          e.preventDefault();
          const touched = engine.clearCell(activeCell);
          setFlashes((prev) => [...prev, ...touched.map((k) => ({ ...keyToRowCol(k), startedAt: performance.now() }))]);
          setDataVersion((v) => v + 1);
          return;
        }
        default:
          // Type-to-replace: any printable character starts a fresh edit, matching the spreadsheet
          // convention `startEdit`'s doc describes.
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            beginEdit(activeCell, e.key);
          }
      }
    },
    [edit, activeCell, commitCurrentEdit, moveActive, beginEdit, engine],
  );

  const a11yRows: number[] = [];
  const [rowStart, rowEnd] = rowRange(viewport);
  for (let r = Math.max(0, Math.floor(rowStart)); r < Math.min(rowCount, Math.ceil(rowEnd)) && a11yRows.length < MAX_A11Y_ROWS; r++) {
    a11yRows.push(r);
  }

  const inputStyle: CSSProperties | null = useMemo(() => {
    if (!edit) return null;
    const [vRowStart, vRowEnd] = rowRange(viewport);
    const rowHeight = (viewport.height - HEADER_HEIGHT) / Math.max(vRowEnd - vRowStart, 1);
    const top = HEADER_HEIGHT + (edit.cell.row - vRowStart) * rowHeight;
    const left = columnOffset(data, edit.cell.col) - scrollX;
    const width = data.columns[edit.cell.col]?.width ?? 80;
    return { position: "absolute", top, left, width, height: rowHeight };
  }, [edit, viewport, data, scrollX]);

  return (
    <div
      {...a11y.rootProps}
      ref={containerRef}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        aria-hidden="true"
        ref={setCanvas}
        style={{
          position: "absolute",
          left: 0,
          top: HEADER_HEIGHT,
          width: "100%",
          height: `calc(100% - ${HEADER_HEIGHT}px)`,
          touchAction: "none",
        }}
      />
      <canvas
        aria-hidden="true"
        ref={textCanvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      {status === "unsupported" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
          WebGPU unavailable.
        </div>
      )}

      {edit && inputStyle && (
        <input
          ref={inputRef}
          value={edit.draft}
          onChange={(e) => setEdit(updateDraft(edit, e.target.value))}
          onBlur={commitCurrentEdit}
          aria-label={`Editing ${formatCellRef(edit.cell)}`}
          style={{
            ...inputStyle,
            font: "12px ui-monospace, monospace",
            color: "#0d0f14",
            background: "#ffffff",
            border: "1.5px solid #0077b6",
            outline: "none",
            padding: "0 8px",
            boxSizing: "border-box",
          }}
        />
      )}

      {a11y.regions()}
      <table style={SR_ONLY}>
        <thead>
          <tr>
            <th scope="col" />
            {data.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {a11yRows.map((r) => (
            <tr key={r}>
              <th scope="row">{r + 1}</th>
              {data.columns.map((c, i) => (
                <td key={c.key} aria-selected={activeCell?.row === r && activeCell?.col === i}>
                  {data.text[i]?.[r] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function a1ToRef(a1: string): CellRef | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(a1.trim());
  if (!m) return null;
  const row = Number.parseInt(m[2]!, 10) - 1;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row, col: col - 1 };
}

function keyToRowCol(key: string): { row: number; col: number } {
  const [col, row] = key.split(",").map(Number);
  return { row: row!, col: col! };
}
