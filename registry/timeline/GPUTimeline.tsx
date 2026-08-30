import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCanvasRef, useGpuComponent } from "@gpu-components/react";
import {
  createPointerController,
  createViewportController,
  normalizeWheel,
} from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { TimelineComponent, type TimelineProps as TimelineComponentProps } from "./TimelineComponent.ts";
import {
  firstSpanIndex,
  lastSpanIndex,
  nearestSpanOnTrack,
  nextSpanInTrack,
  prevSpanInTrack,
} from "./hitTest.ts";
import { describeSpan, describeTimeline, visibleLabels } from "./viewModel.ts";
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
/** Screen reader announcements are debounced to at most one per this many ms (PLAN.md §21.2). */
const ANNOUNCE_DEBOUNCE_MS = 500;

/** Visually-hidden-but-screen-reader-visible — the `tl-summary` region and the `aria-live`
 * announcer (PLAN.md §21.1) are real content, not decorative, so `display: none` (which removes
 * elements from the accessibility tree) is wrong here. */
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

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

/** Pans (never re-zooms) just enough to bring `index` fully into view, clamped to `bounds` — the
 * "focus moves the viewport when the focused span leaves it" half of PLAN.md §21.2. Returns
 * `viewport` unchanged (same reference) when the span is already fully visible, so callers can
 * `!==`-check to skip a no-op viewport update. */
function revealSpan(
  viewport: ViewportState,
  bounds: ViewportBounds,
  spans: SpanBuffers,
  index: number,
): ViewportState {
  const start = spans.start[index]!;
  const end = start + spans.duration[index]!;
  if (start >= viewport.timeStart && end <= viewport.timeEnd) return viewport;

  const span = viewport.timeEnd - viewport.timeStart || 1;
  let timeStart = viewport.timeStart;
  let timeEnd = viewport.timeEnd;
  if (start < viewport.timeStart) {
    timeStart = start;
    timeEnd = timeStart + span;
  } else if (end > viewport.timeEnd) {
    timeEnd = end;
    timeStart = timeEnd - span;
  }
  if (timeStart < bounds.timeMin) {
    timeStart = bounds.timeMin;
    timeEnd = timeStart + span;
  }
  if (timeEnd > bounds.timeMax) {
    timeEnd = bounds.timeMax;
    timeStart = Math.max(bounds.timeMin, timeEnd - span);
  }
  return { ...viewport, timeStart, timeEnd };
}

/**
 * Thin React wrapper (PLAN.md §9.3 — components are registry source, not a package). `viewport`
 * follows the controlled/uncontrolled split from §9.5/§29: pass `onViewportChange` to own pan/zoom
 * yourself (as `apps/site`'s benchmark does), or omit it to let this component manage it. Pointer
 * hover/click drive CPU hit-testing (§9.5's primary mechanism for Timeline); wheel and keyboard both
 * drive pan/zoom.
 *
 * Accessibility (§21.1/§21.2): the canvas is `aria-hidden` — pixels only, never the semantic
 * source. The overlay's labeled spans are the real accessibility tree, exposed as a composite
 * `role="application"` widget: one real tab stop (this component's root), `aria-activedescendant`
 * pointing at the focused span's overlay element when it's currently rendered, and an `aria-live`
 * announcer (debounced to one per 500ms) for focus/selection/domain changes. Keyboard navigation
 * walks the *full* sorted dataset via `hitTest.ts`'s traversal helpers, not just the ≤400
 * currently-labeled/visible spans `visibleLabels` renders — the viewport pans to reveal a span that
 * scrolls out of view, same as a real trace-viewer's roving focus.
 *
 * Not implemented yet (see the migration plan / repo README): Shift+Arrow range selection (needs a
 * broader single-id → set selection model), a shader-pass focus ring (DOM outline only for now),
 * `toAccessibleTable()`, `prefers-reduced-motion` handling (moot — there's no inertial animation to
 * disable yet), touch gestures, and GPU-picking/brush-lasso selection.
 */
export function GPUTimeline(props: GPUTimelineProps): JSX.Element {
  const { spans, onViewportChange, hoveredId, selectedId, onHover, onSelect, style, className } = props;
  const [canvas, ref] = useCanvasRef();
  const appRef = useRef<HTMLDivElement | null>(null);
  const componentRef = useRef<TimelineComponent | null>(null);
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const announceState = useRef<{ lastAt: number; timer: ReturnType<typeof setTimeout> | null }>({
    lastAt: 0,
    timer: null,
  });

  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const bounds = useMemo(() => props.bounds ?? computeBounds(spans), [props.bounds, spans]);
  const summaryId = useId();

  const [focusedId, setFocusedId] = useState<number | null>(null);

  const setViewport = useCallback(
    (next: ViewportState) => {
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    },
    [onViewportChange],
  );

  const announce = useCallback((text: string) => {
    const fire = () => {
      announceState.current.lastAt = performance.now();
      announceState.current.timer = null;
      if (liveRegionRef.current) liveRegionRef.current.textContent = text;
    };
    if (announceState.current.timer) clearTimeout(announceState.current.timer);
    const elapsed = performance.now() - announceState.current.lastAt;
    if (elapsed >= ANNOUNCE_DEBOUNCE_MS) fire();
    else announceState.current.timer = setTimeout(fire, ANNOUNCE_DEBOUNCE_MS - elapsed);
  }, []);

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
      const id = hit ? Number(hit.id) : null;
      onSelect?.(id);
      // A pointer click also relocates keyboard focus, so Tab/arrow navigation picks up from
      // wherever the visitor last clicked instead of wherever it happened to be before.
      if (id != null) setFocusedId(id);
    });

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { deltaX, deltaY } = normalizeWheel(e);
      const controller = createViewportController(viewport, bounds);
      const rect = canvas.getBoundingClientRect();
      controller.zoomAt(e.clientX - rect.left, Math.exp(deltaY * ZOOM_SPEED));
      controller.panByPixels(deltaX);
      setViewport(controller.getState());
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      detachPointer();
      unsubMove();
      unsubLeave();
      unsubUp();
      canvas.removeEventListener("wheel", handleWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewport/bounds are read fresh via closures rebuilt each render through this effect's own deps; onHover/onSelect are assumed stable per the calling convention used elsewhere in this codebase.
  }, [canvas, viewport, bounds, onHover, onSelect, setViewport]);

  // Keyboard navigation (PLAN.md §21.2), attached to the component root, not the canvas — the
  // canvas is `aria-hidden` and never a focus/tab target itself.
  useEffect(() => {
    const el = appRef.current;
    if (!el || spans.count === 0) return;

    const moveFocus = (next: number | null) => {
      if (next == null || next === focusedId) return;
      setFocusedId(next);
      const revealed = revealSpan(viewport, bounds, spans, next);
      if (revealed !== viewport) setViewport(revealed);
      announce(describeSpan(spans, next));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const track = focusedId != null ? spans.track[focusedId]! : 0;
      const atTime = focusedId != null ? spans.start[focusedId]! : viewport.timeStart;
      const controller = createViewportController(viewport, bounds);

      switch (e.key) {
        case "ArrowRight":
          moveFocus(focusedId != null ? nextSpanInTrack(spans, track, focusedId) : firstSpanIndex(spans));
          break;
        case "ArrowLeft":
          moveFocus(focusedId != null ? prevSpanInTrack(spans, track, focusedId) : firstSpanIndex(spans));
          break;
        case "ArrowDown":
          moveFocus(nearestSpanOnTrack(spans, Math.min(track + 1, viewport.trackCount - 1), atTime));
          break;
        case "ArrowUp":
          moveFocus(nearestSpanOnTrack(spans, Math.max(track - 1, 0), atTime));
          break;
        case "Home":
          moveFocus(firstSpanIndex(spans));
          break;
        case "End":
          moveFocus(lastSpanIndex(spans));
          break;
        case "+":
        case "=":
          controller.zoomAt(viewport.width / 2, 0.8);
          setViewport(controller.getState());
          break;
        case "-":
        case "_":
          controller.zoomAt(viewport.width / 2, 1.25);
          setViewport(controller.getState());
          break;
        case "PageDown":
        case "PageUp": {
          controller.panByPixels(e.key === "PageDown" ? viewport.width * 0.9 : -viewport.width * 0.9);
          const next = controller.getState();
          setViewport(next);
          announce(`Showing ${next.timeStart.toFixed(2)} to ${next.timeEnd.toFixed(2)}`);
          break;
        }
        case "Enter":
        case " ":
          if (focusedId != null) {
            onSelect?.(focusedId);
            announce(`Selected: ${describeSpan(spans, focusedId)}`);
          }
          break;
        case "Escape":
          onSelect?.(null);
          setFocusedId(null);
          break;
        default:
          return; // not one of ours — don't preventDefault, don't swallow the event
      }
      e.preventDefault();
    };

    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSelect is assumed stable per the calling convention used elsewhere in this codebase.
  }, [spans, viewport, bounds, focusedId, announce, setViewport, onSelect]);

  const labels = visibleLabels(spans, viewport);
  const focusedVisible = focusedId != null && labels.some((l) => l.id === focusedId);
  const summary = describeTimeline(spans, viewport);

  return (
    <div
      ref={appRef}
      role="application"
      aria-label="Timeline"
      aria-describedby={summaryId}
      aria-activedescendant={focusedVisible ? `tl-span-${focusedId}` : undefined}
      tabIndex={0}
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        ref={ref}
        aria-hidden="true"
        width={viewport.width}
        height={viewport.height}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {labels.map((label) => (
          <span
            key={label.id}
            id={`tl-span-${label.id}`}
            role="listitem"
            aria-label={describeSpan(spans, label.id)}
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
              outline: label.id === focusedId ? "2px solid #8b9dff" : undefined,
              outlineOffset: label.id === focusedId ? 1 : undefined,
            }}
          >
            {label.text}
          </span>
        ))}
      </div>
      <div id={summaryId} style={SR_ONLY}>
        {summary.label}. Showing {viewport.timeStart.toFixed(2)} to {viewport.timeEnd.toFixed(2)}.
      </div>
      <div ref={liveRegionRef} aria-live="polite" style={SR_ONLY} />
    </div>
  );
}
