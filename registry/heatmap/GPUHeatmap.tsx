import {
  createPointerController,
  createViewportController,
  normalizeWheel,
  rowRange,
  trackRowHeight,
  trackToPixelY,
  timeToPixelX,
} from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { useGpu, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { HeatmapComponent } from "./HeatmapComponent.ts";
import { cellIndex, type HeatmapData } from "./ingest.ts";
import type { ColormapName } from "./colormap.ts";

/** Wheel pixels → zoom factor, matching `GPUTimeline`'s feel so the two components agree. */
const ZOOM_SPEED = 0.0015;
/** Row/column headers are DOM text, and the spike in `spikes/grid-text-budget.md` measured where
 * that stops being free: DOM starts dropping frames between 400 and 600 nodes. Headers are one per
 * visible row/column, so this cap is generous — but it is the same budget, honoured explicitly. */
const MAX_HEADERS = 200;
/** Below this, a header would be unreadable and the labels turn into noise. */
const MIN_HEADER_PX = 14;

export interface GPUHeatmapProps {
  readonly data: HeatmapData;
  /** Initial value when uncontrolled; the live value when `onViewportChange` is passed. */
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly colormap?: ColormapName;
  readonly hoveredCell?: number | null;
  readonly onHoverCell?: (index: number | null) => void;
  readonly onSelectCell?: (index: number | null) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/** Full extent of the matrix — pan/zoom is clamped to it on both axes. */
function boundsFor(data: HeatmapData): ViewportBounds {
  return { timeMin: 0, timeMax: data.cols, rowMin: 0, rowMax: data.rows };
}

function describeCell(data: HeatmapData, index: number): string {
  const row = Math.floor(index / data.cols);
  const col = index % data.cols;
  const value = data.values[index];
  const rowName = data.rowLabels?.[row] ?? `Row ${row}`;
  const colName = data.colLabels?.[col] ?? `Column ${col}`;
  const readable = value === undefined || !Number.isFinite(value) ? "no value" : value.toFixed(3);
  return `${rowName}, ${colName}: ${readable}`;
}

/**
 * `GPUHeatmap` — Phase 5's architecture test, stages 4–6 (PLAN.md §29).
 *
 * The accessibility model is §21.1's, applied to a matrix rather than a timeline: the canvas is
 * `aria-hidden`, and the row/column headers are **real DOM text positioned by the same viewport
 * transform the shader uses**, so they cannot drift out of alignment with the pixels and cannot
 * silently rot — breaking the a11y layer breaks the visible labels. Keyboard navigation moves a
 * focused cell through the *whole* matrix, panning the viewport to follow when the focus leaves the
 * visible range, so a keyboard user reaches data that is off-screen.
 *
 * Both axes pan and zoom, which is what forced `core`'s viewport to grow a y axis
 * (`registry/heatmap/CORE-WISHLIST.md`).
 */
export function GPUHeatmap(props: GPUHeatmapProps): JSX.Element {
  const { data, onViewportChange, hoveredCell, onHoverCell, onSelectCell, style, className } = props;
  const { status } = useGpu();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLDivElement | null>(null);
  const summaryId = useId();

  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const bounds = useMemo(() => boundsFor(data), [data]);
  const [focused, setFocused] = useState<number | null>(null);

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const setViewport = useCallback(
    (next: ViewportState) => {
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    },
    [onViewportChange],
  );
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;

  const componentRef = useRef<HeatmapComponent | null>(null);
  const factory = useCallback(() => {
    const component = new HeatmapComponent();
    componentRef.current = component;
    return component;
  }, []);

  const componentProps = useMemo(
    () => ({ data, viewport, colormap: props.colormap }),
    [data, viewport, props.colormap],
  );
  useGpuComponent(factory, canvas, componentProps);

  const announce = useCallback((message: string) => {
    if (liveRef.current) liveRef.current.textContent = message;
  }, []);

  /**
   * Pointer and wheel, attached natively rather than through React's synthetic events: a passive
   * listener cannot call `preventDefault()`, and scrolling the page while zooming the heatmap is
   * not the intended gesture. Same reasoning as `GPUTimeline`'s.
   */
  useEffect(() => {
    const el = canvas;
    if (!el) return;

    const pointer = createPointerController();
    const detachPointer = pointer.attach(el);
    // Drag-to-pan needs the previous position to turn a move into a delta; `PointerState` reports
    // absolute element-local coordinates, so the last one is tracked here.
    let dragFrom: { x: number; y: number } | null = null;

    const unsubDown = pointer.onDown((state) => {
      dragFrom = { x: state.x, y: state.y };
    });

    const unsubMove = pointer.onMove((state) => {
      if (dragFrom && state.dragging) {
        // Drag pans both axes — the gesture a matrix wants, and the one core could not express
        // before it grew a y axis.
        const controller = createViewportController(viewportRef.current, boundsRef.current);
        controller.panByPixels(-(state.x - dragFrom.x), -(state.y - dragFrom.y));
        dragFrom = { x: state.x, y: state.y };
        setViewportRef.current(controller.getState());
        onHoverCell?.(null); // panning, not hovering
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHoverCell?.(hit ? Number(hit.id) : null);
    });

    const unsubLeave = pointer.onLeave(() => onHoverCell?.(null));

    const unsubUp = pointer.onUp((state) => {
      const start = dragFrom;
      dragFrom = null;
      // A press that never moved is a click: select the cell under it.
      if (start && Math.abs(state.x - start.x) < 3 && Math.abs(state.y - start.y) < 3) {
        const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
        const id = hit ? Number(hit.id) : null;
        setFocused(id);
        onSelectCell?.(id);
        if (id != null) announce(describeCell(data, id));
      }
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaX, deltaY } = normalizeWheel(e);
      const controller = createViewportController(viewportRef.current, boundsRef.current);

      if (e.ctrlKey || e.metaKey) {
        // Pinch / ctrl+wheel zooms both axes together, keeping the cell under the cursor fixed.
        const factor = Math.exp(deltaY * ZOOM_SPEED);
        controller.zoomAt(e.clientX - rect.left, factor);
        controller.zoomAtY(e.clientY - rect.top, factor);
      } else {
        // Plain wheel scrolls, which is what a matrix should do: vertical wheel moves rows.
        controller.panByPixels(-deltaX, -deltaY);
      }
      setViewportRef.current(controller.getState());
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      unsubDown();
      unsubMove();
      unsubUp();
      unsubLeave();
      detachPointer();
      el.removeEventListener("wheel", onWheel);
    };
  }, [canvas, data, onHoverCell, onSelectCell, announce]);

  /** Keyboard navigation over the whole matrix, panning to follow focus off-screen (§21.2). */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const current = focused ?? 0;
      let row = Math.floor(current / data.cols);
      let col = current % data.cols;
      const controller = createViewportController(viewportRef.current, boundsRef.current);
      let handled = true;

      switch (e.key) {
        case "ArrowRight": col = Math.min(col + 1, data.cols - 1); break;
        case "ArrowLeft": col = Math.max(col - 1, 0); break;
        case "ArrowDown": row = Math.min(row + 1, data.rows - 1); break;
        case "ArrowUp": row = Math.max(row - 1, 0); break;
        case "Home": col = 0; break;
        case "End": col = data.cols - 1; break;
        case "+":
        case "=":
          controller.zoomAt(viewportRef.current.width / 2, 0.8);
          controller.zoomAtY(viewportRef.current.height / 2, 0.8);
          setViewport(controller.getState());
          e.preventDefault();
          return;
        case "-":
        case "_":
          controller.zoomAt(viewportRef.current.width / 2, 1.25);
          controller.zoomAtY(viewportRef.current.height / 2, 1.25);
          setViewport(controller.getState());
          e.preventDefault();
          return;
        default:
          handled = false;
      }
      if (!handled) return;
      e.preventDefault();

      const next = cellIndex(data, row, col);
      setFocused(next);
      onSelectCell?.(next);
      announce(describeCell(data, next));

      // Follow the focus: if the newly focused cell left the visible window, pan the minimum
      // distance that brings it back, so keyboard users are not confined to the current view.
      const v = viewportRef.current;
      const [rowStart, rowEnd] = rowRange(v);
      let dx = 0;
      let dy = 0;
      if (col < v.timeStart) dx = col - v.timeStart;
      else if (col + 1 > v.timeEnd) dx = col + 1 - v.timeEnd;
      if (row < rowStart) dy = row - rowStart;
      else if (row + 1 > rowEnd) dy = row + 1 - rowEnd;
      if (dx !== 0 || dy !== 0) {
        const pxPerCol = v.width / Math.max(v.timeEnd - v.timeStart, 1e-9);
        const pxPerRow = v.height / Math.max(rowEnd - rowStart, 1e-9);
        controller.panByPixels(-dx * pxPerCol, -dy * pxPerRow);
        setViewport(controller.getState());
      }
    },
    [data, focused, onSelectCell, announce, setViewport],
  );

  // Row and column headers: real DOM text, positioned by the *same* transform the shader uses
  // (§21.1). Virtualised to the visible range and capped, per the text spike's measured budget.
  const headers = useMemo(() => {
    const [rowStart, rowEnd] = rowRange(viewport);
    const rowHeight = trackRowHeight(viewport);
    const rows: { key: string; text: string; top: number }[] = [];
    if (rowHeight >= MIN_HEADER_PX) {
      for (let r = Math.max(0, Math.floor(rowStart)); r < Math.min(data.rows, Math.ceil(rowEnd)); r++) {
        if (rows.length >= MAX_HEADERS) break;
        rows.push({
          key: `r${r}`,
          text: data.rowLabels?.[r] ?? String(r),
          top: trackToPixelY(viewport, r),
        });
      }
    }

    const colWidth = viewport.width / Math.max(viewport.timeEnd - viewport.timeStart, 1e-9);
    const cols: { key: string; text: string; left: number }[] = [];
    if (colWidth >= MIN_HEADER_PX) {
      for (let c = Math.max(0, Math.floor(viewport.timeStart)); c < Math.min(data.cols, Math.ceil(viewport.timeEnd)); c++) {
        if (cols.length >= MAX_HEADERS) break;
        cols.push({
          key: `c${c}`,
          text: data.colLabels?.[c] ?? String(c),
          left: timeToPixelX(viewport, c + 0.5),
        });
      }
    }
    return { rows, cols };
  }, [viewport, data]);

  const [rowStart, rowEnd] = rowRange(viewport);
  const summary =
    `${data.rows} rows by ${data.cols} columns. ` +
    `Showing rows ${Math.floor(rowStart)} to ${Math.ceil(rowEnd)}, ` +
    `columns ${Math.floor(viewport.timeStart)} to ${Math.ceil(viewport.timeEnd)}.`;

  return (
    <div
      role="application"
      aria-label={props["aria-label"] ?? "Heatmap"}
      aria-describedby={summaryId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        aria-hidden="true"
        ref={(el) => {
          canvasRef.current = el;
          setCanvas(el);
        }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      {status === "unsupported" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
          WebGPU unavailable.
        </div>
      )}

      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {headers.rows.map((r) => (
          <span
            key={r.key}
            style={{
              position: "absolute",
              left: 2,
              top: r.top,
              transform: "translateY(-50%)",
              font: "11px ui-monospace, monospace",
              color: "#e7e9ee",
              textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            }}
          >
            {r.text}
          </span>
        ))}
        {headers.cols.map((c) => (
          <span
            key={c.key}
            style={{
              position: "absolute",
              left: c.left,
              top: 2,
              transform: "translateX(-50%)",
              font: "11px ui-monospace, monospace",
              color: "#e7e9ee",
              textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            }}
          >
            {c.text}
          </span>
        ))}
      </div>

      <div id={summaryId} style={srOnly}>
        {summary}
      </div>
      <div ref={liveRef} aria-live="polite" style={srOnly} />
      {focused != null && <div style={srOnly}>{describeCell(data, focused)}</div>}
      {hoveredCell != null && <div style={srOnly}>{describeCell(data, hoveredCell)}</div>}
    </div>
  );
}

const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};
