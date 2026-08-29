import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCanvasRef, useGpuComponent } from "@gpu-components/react";
import {
  createPointerController,
  createViewportController,
  normalizeWheel,
} from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { TimelineComponent, type TimelineProps as TimelineComponentProps } from "./TimelineComponent.ts";
import { visibleLabels } from "./viewModel.ts";
import type { SpanBuffers } from "./ingest.ts";

export interface GPUTimelineProps {
  readonly spans: SpanBuffers;
  /** Initial value when uncontrolled; the live value when `onViewportChange` is passed. */
  readonly viewport: ViewportState;
  /** Presence makes `viewport` controlled — the parent owns pan/zoom, same convention as a
   * controlled `<input>`. Omit to let `GPUTimeline` manage its own viewport state internally. */
  readonly onViewportChange?: (viewport: ViewportState) => void;
  /** The time domain pan/zoom is clamped to. Defaults to the data's own `[min start, max end]`. */
  readonly bounds?: ViewportBounds;
  readonly hoveredId?: number | null;
  readonly selectedId?: number | null;
  readonly onHover?: (id: number | null) => void;
  readonly onSelect?: (id: number | null) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
}

/** How many clip-space zoom "steps" one native wheel pixel of deltaY corresponds to. */
const ZOOM_SPEED = 0.0015;

function computeBounds(spans: SpanBuffers): ViewportBounds {
  if (spans.count === 0) return { timeMin: 0, timeMax: 1 };
  let timeMin = Infinity;
  let timeMax = -Infinity;
  for (let i = 0; i < spans.count; i++) {
    const start = spans.start[i]!;
    const end = start + spans.duration[i]!;
    if (start < timeMin) timeMin = start;
    if (end > timeMax) timeMax = end;
  }
  return { timeMin, timeMax };
}

/**
 * Thin React wrapper (PLAN.md §9.3 — components are registry source, not a package). `viewport`
 * follows the controlled/uncontrolled split from §9.5/§29: pass `onViewportChange` to own pan/zoom
 * yourself (as `apps/site`'s benchmark does), or omit it to let this component manage it. Pointer
 * hover/click drive CPU hit-testing (§9.5's primary mechanism for Timeline); wheel drives pan/zoom.
 * Keyboard navigation, touch gestures, and brush/lasso selection are not implemented in v1.
 */
export function GPUTimeline(props: GPUTimelineProps): JSX.Element {
  const { spans, onViewportChange, hoveredId, selectedId, onHover, onSelect, style, className } = props;
  const [canvas, ref] = useCanvasRef();
  const componentRef = useRef<TimelineComponent | null>(null);

  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const bounds = useMemo(() => props.bounds ?? computeBounds(spans), [props.bounds, spans]);

  useGpuComponent<TimelineComponentProps>(
    () => {
      // `runtime.mount()` (via `useGpuComponent`) calls `create()` on whatever this factory
      // returns — it must only construct the component, not initialize it itself.
      const component = new TimelineComponent(spans.count);
      componentRef.current = component;
      return component;
    },
    canvas,
    { spans, viewport, hoveredId, selectedId },
  );

  // Pointer hover/click and wheel pan/zoom, attached directly (not via React's synthetic wheel
  // handler, which React 18 registers passively at the root — `preventDefault()` there would
  // silently no-op, and scrolling the page while zooming the timeline is not the intended gesture).
  useEffect(() => {
    if (!canvas) return;

    const pointer = createPointerController();
    const detachPointer = pointer.attach(canvas);
    const unsubMove = pointer.onMove((state) => {
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHover?.(hit ? Number(hit.id) : null);
    });
    const unsubLeave = pointer.onLeave(() => onHover?.(null));
    const unsubUp = pointer.onUp((state) => {
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onSelect?.(hit ? Number(hit.id) : null);
    });

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { deltaX, deltaY } = normalizeWheel(e);
      const controller = createViewportController(viewport, bounds);
      const rect = canvas.getBoundingClientRect();
      controller.zoomAt(e.clientX - rect.left, Math.exp(deltaY * ZOOM_SPEED));
      controller.panByPixels(deltaX);
      const next = controller.getState();
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      detachPointer();
      unsubMove();
      unsubLeave();
      unsubUp();
      canvas.removeEventListener("wheel", handleWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewport/bounds are read fresh via closures rebuilt each render through this effect's own deps; onHover/onSelect/onViewportChange are assumed stable per the calling convention used elsewhere in this codebase.
  }, [canvas, viewport, bounds, onHover, onSelect, onViewportChange]);

  const labels = visibleLabels(spans, viewport);

  return (
    <div
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        ref={ref}
        width={viewport.width}
        height={viewport.height}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {labels.map((label) => (
          <span
            key={label.id}
            style={{
              position: "absolute",
              left: label.x,
              top: label.y,
              width: label.width,
              height: label.height,
              lineHeight: `${label.height}px`,
              overflow: "hidden",
              whiteSpace: "nowrap",
              fontSize: 11,
              color: "#fff",
              paddingLeft: 4,
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          >
            {label.text}
          </span>
        ))}
      </div>
    </div>
  );
}
