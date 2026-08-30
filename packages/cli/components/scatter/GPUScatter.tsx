import { createPointerController, createViewportController, normalizeWheel } from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { ScatterComponent } from "./ScatterComponent.ts";
import { pointsInRect } from "./spatialIndex.ts";
import type { ScatterData } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;
/** A press that moves less than this is a click, not a brush. */
const DRAG_THRESHOLD_PX = 4;

export interface GPUScatterProps {
  readonly data: ScatterData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly pointSizePx?: number;
  /** 1-based; 0 shows every category. */
  readonly categoryFilter?: number;
  readonly hoveredIndex?: number | null;
  readonly onHover?: (index: number | null) => void;
  /** Fires when a brush drag ends, with every point inside the rectangle. */
  readonly onBrushSelection?: (indices: readonly number[]) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

function describePoint(data: ScatterData, index: number): string {
  const category = data.category[index] ?? 0;
  const name = data.categoryNames?.[category] ?? `category ${category}`;
  return `Point ${index}: x ${data.x[index]?.toFixed(3)}, y ${data.y[index]?.toFixed(3)}, ${name}`;
}

/**
 * `GPUScatter` — one instanced draw, N points, and every interaction a uniform write.
 *
 * The y axis runs `yContinuous` (PLAN.md's viewport gained the flag for this component): a scatter's
 * y is a value, not a row index, so `yMin` must land on the bottom edge rather than half a band
 * above it.
 *
 * Hover is an exact CPU lookup through a uniform grid built once per dataset — see
 * `spatialIndex.ts` for why that beats the asynchronous GPU picking §9.5 routes this component to.
 */
export function GPUScatter(props: GPUScatterProps): JSX.Element {
  const { data, onViewportChange, onHover, onBrushSelection, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const [brush, setBrush] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const bounds: ViewportBounds = useMemo(
    () => ({
      timeMin: data.bounds.xMin,
      timeMax: data.bounds.xMax,
      rowMin: data.bounds.yMin,
      rowMax: data.bounds.yMax,
    }),
    [data.bounds],
  );

  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Scatter plot",
    summary:
      `${data.count.toLocaleString("en-US")} points. ` +
      `x from ${viewport.timeStart.toFixed(2)} to ${viewport.timeEnd.toFixed(2)}, ` +
      `y from ${(viewport.rowStart ?? 0).toFixed(2)} to ${(viewport.rowEnd ?? 0).toFixed(2)}.`,
  });

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

  const componentRef = useRef<ScatterComponent | null>(null);
  const factory = useCallback(() => {
    const component = new ScatterComponent(data.count);
    componentRef.current = component;
    return component;
  }, [data.count]);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({
        data,
        viewport,
        pointSizePx: props.pointSizePx,
        categoryFilter: props.categoryFilter,
        hoveredIndex: props.hoveredIndex,
      }),
      [data, viewport, props.pointSizePx, props.categoryFilter, props.hoveredIndex],
    ),
  );

  useEffect(() => {
    const el = canvas;
    if (!el) return;
    const pointer = createPointerController();
    const detach = pointer.attach(el);
    let dragFrom: { x: number; y: number } | null = null;

    const unsubDown = pointer.onDown((state) => {
      dragFrom = { x: state.x, y: state.y };
    });

    const unsubMove = pointer.onMove((state) => {
      if (dragFrom && state.dragging) {
        // A drag brushes rather than pans: with both axes zoomable by wheel, selection is the more
        // useful default gesture for a point cloud.
        setBrush({ x0: dragFrom.x, y0: dragFrom.y, x1: state.x, y1: state.y });
        onHover?.(null);
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHover?.(hit ? Number(hit.id) : null);
    });

    const unsubLeave = pointer.onLeave(() => onHover?.(null));

    const unsubUp = pointer.onUp((state) => {
      const start = dragFrom;
      dragFrom = null;
      setBrush(null);
      const component = componentRef.current;
      if (!start || !component) return;

      const moved = Math.hypot(state.x - start.x, state.y - start.y);
      if (moved < DRAG_THRESHOLD_PX) {
        const hit = component.hitTest(state.x, state.y);
        if (hit) a11y.announce(describePoint(data, Number(hit.id)));
        return;
      }

      // Screen rectangle -> data rectangle, then one indexed query. The GPU renders the resulting
      // bitset; the CPU never loops over points to draw them (§9.5's hybrid model).
      const v = viewportRef.current;
      const rowStart = v.rowStart ?? 0;
      const rowEnd = v.rowEnd ?? v.trackCount;
      const toDataX = (px: number) => v.timeStart + (px / Math.max(v.width, 1)) * (v.timeEnd - v.timeStart);
      const toDataY = (py: number) => rowEnd - (py / Math.max(v.height, 1)) * (rowEnd - rowStart);
      const index = component.spatialIndex;
      if (!index) return;

      const xs = [toDataX(start.x), toDataX(state.x)].sort((a, b) => a - b);
      const ys = [toDataY(start.y), toDataY(state.y)].sort((a, b) => a - b);
      const found = pointsInRect(index, data, xs[0]!, ys[0]!, xs[1]!, ys[1]!);
      component.setSelection(found);
      onBrushSelection?.(found);
      a11y.announce(`${found.length} points selected`);
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaY } = normalizeWheel(e);
      const factor = Math.exp(deltaY * ZOOM_SPEED);
      const controller = createViewportController(viewportRef.current, boundsRef.current);
      // Both axes together, anchored at the cursor — a scatter has no privileged axis.
      controller.zoomAt(e.clientX - rect.left, factor);
      controller.zoomAtY(e.clientY - rect.top, factor);
      setViewportRef.current(controller.getState());
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      unsubDown();
      unsubMove();
      unsubUp();
      unsubLeave();
      detach();
      el.removeEventListener("wheel", onWheel);
    };
  }, [canvas, data, onHover, onBrushSelection, a11y]);

  return (
    <div
      {...a11y.rootProps}
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        aria-hidden="true"
        ref={setCanvas}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      {status === "unsupported" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
          WebGPU unavailable.
        </div>
      )}
      {brush && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: Math.min(brush.x0, brush.x1),
            top: Math.min(brush.y0, brush.y1),
            width: Math.abs(brush.x1 - brush.x0),
            height: Math.abs(brush.y1 - brush.y0),
            border: "1px solid rgba(255,255,255,0.8)",
            background: "rgba(255,255,255,0.12)",
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />
      )}
      {a11y.regions()}
      {props.hoveredIndex != null && <div style={SR_ONLY}>{describePoint(data, props.hoveredIndex)}</div>}
    </div>
  );
}
