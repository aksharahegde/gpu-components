import { createPointerController, createViewportController, normalizeWheel, rowRange } from "@gpuc/core";
import type { ViewportBounds, ViewportState } from "@gpuc/core";
import { SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpuc/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { GridComponent } from "./GridComponent.ts";
import { columnOffset, totalWidth, type GridData } from "./ingest.ts";
import { drawGridText, HEADER_HEIGHT } from "./textLayer.ts";

/** How many rows a wheel notch scrolls. */
const WHEEL_ROWS = 3;
/** Rows exposed to assistive technology as real DOM text — see the a11y note below. */
const MAX_A11Y_ROWS = 30;

export interface GPUDataGridProps {
  readonly data: GridData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly scrollX?: number;
  readonly onScrollXChange?: (x: number) => void;
  readonly selectedRow?: number | null;
  readonly onSelectRow?: (row: number | null) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

function cellText(data: GridData, row: number, column: number): string {
  return data.text[column]?.[row] ?? "";
}

function describeRow(data: GridData, row: number): string {
  return data.columns.map((c, i) => `${c.label}: ${cellText(data, row, i) || "empty"}`).join(", ");
}

/**
 * `GPUDataGrid` — read-only v1 (PLAN.md §29 Phase 5, §8.1).
 *
 * **A hybrid by measurement, not by compromise.** The GPU draws cell chrome and per-cell
 * conditional formatting in one raster pass; a Canvas2D layer draws the text, because
 * `spikes/grid-text-budget.md` measured that at 2.9ms per frame for 2,400 cells and a glyph atlas
 * was the phase's largest schedule risk. The DOM draws nothing per cell — it drops every frame past
 * ~1,200 nodes.
 *
 * **Accessibility, given that canvas text is not selectable.** The spike flagged this as the one
 * real cost of the verdict, so it is answered explicitly rather than left to v2: the visible rows
 * are mirrored into a real `<table>` in the accessibility tree (capped, virtualised to the
 * viewport), the focused row is rendered as *selectable, copyable* DOM text, and the whole grid
 * carries a summary and a live region. §21.2's "labels are real DOM text" holds for everything a
 * screen reader or a copying user actually touches; the canvas covers the other ~2,370 cells, which
 * no assistive technology was going to read one at a time anyway.
 */
export function GPUDataGrid(props: GPUDataGridProps): JSX.Element {
  const { data, onViewportChange, onScrollXChange, onSelectRow, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const textCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const [internalScrollX, setInternalScrollX] = useState(props.scrollX ?? 0);
  const scrollX = onScrollXChange ? (props.scrollX ?? 0) : internalScrollX;

  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const selectedRow = props.selectedRow ?? focusedRow;

  const bounds: ViewportBounds = useMemo(
    () => ({ timeMin: 0, timeMax: 1, rowMin: 0, rowMax: data.rowCount }),
    [data.rowCount],
  );
  const maxScrollX = Math.max(0, totalWidth(data) - viewport.width);

  const [visibleRowStart, visibleRowEnd] = rowRange(viewport);
  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Data grid",
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

  const componentRef = useRef<GridComponent | null>(null);
  const factory = useCallback(() => {
    const component = new GridComponent();
    componentRef.current = component;
    return component;
  }, []);

  // The grid surface sits below the header strip the text layer paints, so the component's own
  // viewport is the body only — otherwise row 0 would render underneath the header.
  const bodyViewport = useMemo(
    () => ({ ...viewport, height: Math.max(1, viewport.height - HEADER_HEIGHT) }),
    [viewport],
  );

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({ data, viewport: bodyViewport, scrollX, hoveredRow, selectedRow }),
      [data, bodyViewport, scrollX, hoveredRow, selectedRow],
    ),
  );

  /** Repaint the text layer whenever what it shows changes — not every frame (damage-based). */
  useEffect(() => {
    const el = textCanvasRef.current;
    if (!el) return;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    el.width = Math.round(viewport.width * dpr);
    el.height = Math.round(viewport.height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    drawGridText(ctx, { data, viewport: bodyViewport, scrollX, dpr });
  }, [data, viewport, bodyViewport, scrollX]);

  useEffect(() => {
    const el = canvas;
    if (!el) return;
    const pointer = createPointerController();
    const detach = pointer.attach(el);

    const unsubMove = pointer.onMove((state) => {
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      setHoveredRow(hit ? Math.floor(Number(hit.id) / data.columns.length) : null);
    });
    const unsubLeave = pointer.onLeave(() => setHoveredRow(null));
    const unsubUp = pointer.onUp((state) => {
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      const row = hit ? Math.floor(Number(hit.id) / data.columns.length) : null;
      setFocusedRow(row);
      onSelectRow?.(row);
      if (row != null) a11y.announce(describeRow(data, row));
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
      const rowsPerPixel = (v.rowEnd ?? data.rowCount) - (v.rowStart ?? 0);
      const pixels = (deltaY / 100) * WHEEL_ROWS * (v.height / Math.max(rowsPerPixel, 1));
      controller.panByPixels(0, pixels);
      const next = controller.getState();
      setViewportRef.current({ ...v, rowStart: next.rowStart, rowEnd: next.rowEnd });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      unsubMove();
      unsubLeave();
      unsubUp();
      detach();
      el.removeEventListener("wheel", onWheel);
    };
  }, [canvas, data, bounds, maxScrollX, onSelectRow, a11y]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const [rowStart, rowEnd] = rowRange(viewport);
      const visible = Math.max(1, Math.floor(rowEnd - rowStart));
      let row = focusedRow ?? Math.floor(rowStart);
      let handled = true;

      switch (e.key) {
        case "ArrowDown": row = Math.min(row + 1, data.rowCount - 1); break;
        case "ArrowUp": row = Math.max(row - 1, 0); break;
        case "PageDown": row = Math.min(row + visible, data.rowCount - 1); break;
        case "PageUp": row = Math.max(row - visible, 0); break;
        case "Home": row = 0; break;
        case "End": row = data.rowCount - 1; break;
        default: handled = false;
      }
      if (!handled) return;
      e.preventDefault();

      setFocusedRow(row);
      onSelectRow?.(row);
      a11y.announce(describeRow(data, row));

      // Scroll to keep the focused row visible — keyboard users navigate the whole dataset, not
      // just what happens to be on screen (§21.2).
      if (row < rowStart || row >= rowEnd) {
        const span = rowEnd - rowStart;
        const start = Math.max(0, Math.min(data.rowCount - span, row < rowStart ? row : row - span + 1));
        setViewport({ ...viewport, rowStart: start, rowEnd: start + span });
      }
    },
    [viewport, focusedRow, data, onSelectRow, setViewport, a11y],
  );

  const [rowStart, rowEnd] = rowRange(viewport);
  const a11yRows: number[] = [];
  for (let r = Math.max(0, Math.floor(rowStart)); r < Math.min(data.rowCount, Math.ceil(rowEnd)) && a11yRows.length < MAX_A11Y_ROWS; r++) {
    a11yRows.push(r);
  }

  return (
    <div
      {...a11y.rootProps}
      onKeyDown={onKeyDown}
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

      {/* The focused row as real, selectable, copyable DOM text — the answer to canvas text not
          being selectable, which `spikes/grid-text-budget.md` flagged as the cost of its verdict. */}
      {focusedRow != null && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: HEADER_HEIGHT + ((focusedRow - rowStart) * (viewport.height - HEADER_HEIGHT)) / Math.max(rowEnd - rowStart, 1),
            height: (viewport.height - HEADER_HEIGHT) / Math.max(rowEnd - rowStart, 1),
            display: "flex",
            alignItems: "center",
            font: "12px ui-monospace, monospace",
            color: "#1f2430",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          {data.columns.map((column, c) => (
            <span
              key={column.key}
              style={{
                position: "absolute",
                left: columnOffset(data, c) - scrollX + 8,
                width: column.width - 16,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                textAlign: column.align === "right" ? "right" : "left",
                pointerEvents: "auto",
              }}
            >
              {cellText(data, focusedRow, c)}
            </span>
          ))}
        </div>
      )}

      {a11y.regions()}
      {/* `toAccessibleTable()` in DOM form (§21.2): the visible rows as a real table, so assistive
          technology that cannot use the canvas at all still gets structured, navigable content. */}
      <table style={SR_ONLY}>
        <thead>
          <tr>{data.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {a11yRows.map((r) => (
            <tr key={r} aria-selected={r === selectedRow}>
              {data.columns.map((c, i) => <td key={c.key}>{cellText(data, r, i)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

