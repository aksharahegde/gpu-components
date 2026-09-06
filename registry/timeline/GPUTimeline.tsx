import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LabelOverlay, useCanvasRef, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import type { PositionedLabel } from "@gpu-components/react";
import {
  brushRectFromPixels,
  createPointerController,
  createVelocityTracker,
  createViewportController,
  decayVelocity,
  INERTIA_STOP_VELOCITY,
  normalizeWheel,
  timeToPixelX,
  trackRowHeight,
  trackToPixelY,
} from "@gpu-components/core";
import type { BrushRect, ViewportBounds, ViewportState } from "@gpu-components/core";
import { TimelineComponent, type TimelineProps as TimelineComponentProps } from "./TimelineComponent.ts";
import {
  firstSpanIndex,
  lastSpanIndex,
  nearestSpanOnTrack,
  nextSpanInTrack,
  prevSpanInTrack,
  selectSpansInRange,
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
  /** Fires once a click-drag past the movement threshold ends (PLAN.md Phase 3's brush selection) —
   * `ids` is the final selected set, computed CPU-side (`hitTest.ts`'s `selectSpansInRange`) once,
   * not per frame; the live highlight while dragging is GPU-only (`TimelineComponent`'s
   * `brushRect` prop, driven internally, not by this callback). */
  readonly onBrushSelectionChange?: (rect: BrushRect, ids: readonly number[]) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
}

/** How many clip-space zoom "steps" one native wheel pixel of deltaY corresponds to. */
const ZOOM_SPEED = 0.0015;
/** How long after the last wheel event, with no new one arriving, before treating the gesture as
 * "over" and starting inertial pan decay (PLAN.md Phase 3) — roughly the gap a trackpad's own
 * discrete wheel-event stream leaves between events *during* a swipe, so real ongoing swipes don't
 * get cut off mid-gesture. */
const WHEEL_IDLE_MS = 80;
/** CSS pixels of pointer movement between down and up before a gesture counts as a brush drag
 * rather than a plain click — below this, existing click-select behavior (`onSelect`) applies
 * unchanged. */
const DRAG_THRESHOLD_PX = 4;

function pixelDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Visually-hidden-but-screen-reader-visible — the `tl-summary` region and the `aria-live`
 * announcer (PLAN.md §21.1) are real content, not decorative, so `display: none` (which removes
 * elements from the accessibility tree) is wrong here. */

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
 * Wheel gestures also drive inertial pan (PLAN.md Phase 3): a `VelocityTracker` (`@gpu-components/core`)
 * is fed from each wheel event's pan delta, and `WHEEL_IDLE_MS` after the last one, decays that
 * velocity across `requestAnimationFrame`s via `decayVelocity` until it settles. Honors
 * `prefers-reduced-motion` (no decay animation at all, per §21/§32) and is cancelled by any new
 * wheel gesture, keyboard pan/zoom, or unmount, so it never fights an explicit interaction.
 *
 * A click-drag past `DRAG_THRESHOLD_PX` is a brush selection (PLAN.md §9.5's "Hybrid" model,
 * scoped to an axis-aligned rectangle — see `brush.ts`'s doc comment for why not true lasso): while
 * dragging, `brushRectFromPixels` recomputes the drag rectangle every pointer move, driving both a
 * lightweight DOM overlay (this component) and `TimelineComponent`'s live GPU bitset highlight
 * (`brushSelect.wgsl.ts` — handles millions of spans, not a JS loop). On release, the final id set
 * is computed once, CPU-side (`hitTest.ts`'s `selectSpansInRange`), and handed to
 * `onBrushSelectionChange`. A drag that doesn't clear the threshold is treated as a plain click —
 * the existing `onSelect` path, unchanged.
 *
 * Not implemented yet (see the migration plan / repo README): Shift+Arrow range selection (needs a
 * broader single-id → set selection model), a shader-pass focus ring (DOM outline only for now),
 * `toAccessibleTable()`, touch gestures, and true lasso/polygon selection.
 */
export function GPUTimeline(props: GPUTimelineProps): JSX.Element {
  const { spans, onViewportChange, hoveredId, selectedId, onHover, onSelect, onBrushSelectionChange, style, className } =
    props;
  const [canvas, ref] = useCanvasRef();
  const appRef = useRef<HTMLDivElement | null>(null);
  const componentRef = useRef<TimelineComponent | null>(null);

  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const bounds = useMemo(() => props.bounds ?? computeBounds(spans), [props.bounds, spans]);

  // Inertial pan (PLAN.md Phase 3). `viewportRef`/`boundsRef` give the inertia rAF loop — which
  // runs across many frames, independent of React's render cycle — the *current* values without
  // stale closures; kept in sync every render (a plain mutation, not state: nothing here affects
  // this render's own output, only a later async callback's). `inertiaFrame`/`velocityTracker`/
  // `lastWheelAt`/`wheelIdleTimer` are refs so they persist across re-renders without themselves
  // triggering one.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const velocityTracker = useRef(createVelocityTracker());
  const lastWheelAt = useRef<number | null>(null);
  const wheelIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inertiaFrame = useRef<number | null>(null);

  const [focusedId, setFocusedId] = useState<number | null>(null);
  // Brush selection (PLAN.md Phase 3). `brushRect` is the live drag rectangle — internal state, not
  // controlled, since it only exists during a gesture; `dragStart` tracks the pointerdown origin so
  // `onMove`/`onUp` can tell a real drag from a plain click via `DRAG_THRESHOLD_PX`.
  const [brushRect, setBrushRect] = useState<BrushRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const setViewport = useCallback(
    (next: ViewportState) => {
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    },
    [onViewportChange],
  );

  /** Stops any in-flight inertia decay — called when a new wheel gesture starts (it takes over) or
   * another interaction (keyboard pan/zoom, unmount) explicitly drives the viewport instead. */
  const cancelInertia = useCallback(() => {
    if (wheelIdleTimer.current != null) {
      clearTimeout(wheelIdleTimer.current);
      wheelIdleTimer.current = null;
    }
    if (inertiaFrame.current != null) {
      cancelAnimationFrame(inertiaFrame.current);
      inertiaFrame.current = null;
    }
  }, []);

  /** Starts the post-wheel-gesture pan decay (PLAN.md Phase 3, "inertial pan/zoom
   * (reduced-motion aware)") — called once `WHEEL_IDLE_MS` after the last wheel event. Honors
   * `prefers-reduced-motion` by not animating at all, per PLAN.md §21/§32's acceptance criterion.
   * Reads/writes `viewportRef.current` each frame rather than the `viewport` prop/closure, since
   * this loop runs across many animation frames independent of when React actually re-renders. */
  const startInertia = useCallback(() => {
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      velocityTracker.current.reset();
      return;
    }
    let v = velocityTracker.current.velocity();
    if (Math.abs(v) < INERTIA_STOP_VELOCITY) return;

    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      v = decayVelocity(v, dt);
      const controller = createViewportController(viewportRef.current, boundsRef.current);
      controller.panByPixels(v * dt);
      const next = controller.getState();
      viewportRef.current = next;
      setViewport(next);
      if (Math.abs(v) < INERTIA_STOP_VELOCITY) {
        inertiaFrame.current = null;
        return;
      }
      inertiaFrame.current = requestAnimationFrame(step);
    };
    inertiaFrame.current = requestAnimationFrame(step);
  }, [setViewport]);

  // Stop inertia on unmount — otherwise its rAF chain keeps calling `setViewport` on an unmounted
  // component's state (harmless with `onViewportChange`, a `setState`-after-unmount warning
  // otherwise).
  useEffect(() => cancelInertia, [cancelInertia]);

  // Computed before the a11y hook because `activeDescendantId` depends on it.
  const labels = visibleLabels(spans, viewport);
  const focusedVisible = focusedId != null && labels.some((l) => l.id === focusedId);

  // The shared §21.1 overlay — named root, described summary, and the 500ms-debounced live region
  // §21.2 asks for. That debounce used to live only here; it now covers every component.
  const semantics = describeTimeline(spans, viewport);
  const a11y = useGpuA11y({
    label: "Timeline",
    summary: `${semantics.label}. Showing ${viewport.timeStart.toFixed(2)} to ${viewport.timeEnd.toFixed(2)}.`,
    activeDescendantId: focusedVisible ? `tl-span-${focusedId}` : undefined,
  });
  const announce = a11y.announce;

  useGpuComponent<TimelineComponentProps>(
    () => {
      // `runtime.mount()` (via `useGpuComponent`) calls `create()` on whatever this factory
      // returns — it must only construct the component, not initialize it itself.
      const component = new TimelineComponent(spans.count);
      componentRef.current = component;
      return component;
    },
    canvas,
    { spans, viewport, hoveredId, selectedId, brushRect },
  );

  // Pointer hover/click and wheel pan/zoom, attached directly (not via React's synthetic wheel
  // handler, which React 18 registers passively at the root — `preventDefault()` there would
  // silently no-op, and scrolling the page while zooming the timeline is not the intended gesture).
  useEffect(() => {
    if (!canvas) return;

    const pointer = createPointerController();
    const detachPointer = pointer.attach(canvas);
    const unsubDown = pointer.onDown((state) => {
      dragStart.current = { x: state.x, y: state.y };
    });
    const unsubMove = pointer.onMove((state) => {
      const start = dragStart.current;
      if (start && pixelDistance(start, state) >= DRAG_THRESHOLD_PX) {
        setBrushRect(brushRectFromPixels(viewport, start.x, start.y, state.x, state.y));
        onHover?.(null); // dragging a brush, not hovering a single span
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHover?.(hit ? Number(hit.id) : null);
    });
    const unsubLeave = pointer.onLeave(() => onHover?.(null));
    const unsubUp = pointer.onUp((state) => {
      const start = dragStart.current;
      dragStart.current = null;

      if (start && pixelDistance(start, state) >= DRAG_THRESHOLD_PX) {
        // A completed brush drag — the final id set is computed once here, not per frame; the
        // live highlight the visitor was seeing while dragging came from the GPU bitset instead.
        const rect = brushRectFromPixels(viewport, start.x, start.y, state.x, state.y);
        const ids = selectSpansInRange(spans, rect.trackMin, rect.trackMax, rect.timeStart, rect.timeEnd);
        onBrushSelectionChange?.(rect, ids);
        setBrushRect(null);
        return;
      }

      setBrushRect(null); // no-op if a drag never crossed the threshold
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      const id = hit ? Number(hit.id) : null;
      onSelect?.(id);
      // A pointer click also relocates keyboard focus, so Tab/arrow navigation picks up from
      // wherever the visitor last clicked instead of wherever it happened to be before.
      if (id != null) setFocusedId(id);
    });

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelInertia(); // this gesture (or its continuation) takes over from any decaying inertia
      const { deltaX, deltaY } = normalizeWheel(e);
      const controller = createViewportController(viewport, bounds);
      const rect = canvas.getBoundingClientRect();
      controller.zoomAt(e.clientX - rect.left, Math.exp(deltaY * ZOOM_SPEED));
      controller.panByPixels(deltaX);
      setViewport(controller.getState());

      // Feed the inertia velocity tracker from this gesture's pan component, then arm the
      // "gesture ended" timer — reset on every wheel event, so it only actually fires
      // `WHEEL_IDLE_MS` after the *last* one (PLAN.md Phase 3's inertial pan).
      const now = performance.now();
      const dt = lastWheelAt.current != null ? now - lastWheelAt.current : 16;
      velocityTracker.current.record(deltaX, dt);
      lastWheelAt.current = now;
      if (wheelIdleTimer.current != null) clearTimeout(wheelIdleTimer.current);
      wheelIdleTimer.current = setTimeout(() => {
        wheelIdleTimer.current = null;
        lastWheelAt.current = null;
        startInertia();
      }, WHEEL_IDLE_MS);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      detachPointer();
      unsubDown();
      unsubMove();
      unsubLeave();
      unsubUp();
      canvas.removeEventListener("wheel", handleWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewport/bounds are read fresh via closures rebuilt each render through this effect's own deps; onHover/onSelect/onBrushSelectionChange/cancelInertia/startInertia are assumed stable per the calling convention used elsewhere in this codebase.
  }, [canvas, viewport, bounds, spans, onHover, onSelect, onBrushSelectionChange, setViewport, cancelInertia, startInertia]);

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
      cancelInertia(); // keyboard pan/zoom takes precedence over any decaying wheel inertia
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSelect/cancelInertia are assumed stable per the calling convention used elsewhere in this codebase.
  }, [spans, viewport, bounds, focusedId, announce, setViewport, onSelect, cancelInertia]);

  return (
    <div
      ref={appRef}
      {...a11y.rootProps}
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
      <LabelOverlay
        labels={labels.map<PositionedLabel>((label) => ({
          key: label.id,
          id: `tl-span-${label.id}`,
          left: label.x,
          top: label.y,
          width: label.width,
          height: label.height,
          text: label.text,
          ariaLabel: describeSpan(spans, label.id),
          focused: label.id === focusedId,
        }))}
      />
      {brushRect && (
        // Lightweight DOM selection-box overlay for the drag in progress — cheap, standard UX,
        // no GPU/canvas work. The live *highlight of matching spans* is a separate, GPU-only
        // concern (TimelineComponent's brushRect prop -> brushSelect.wgsl.ts's bitset).
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: timeToPixelX(viewport, brushRect.timeStart),
            top: trackToPixelY(viewport, brushRect.trackMin) - trackRowHeight(viewport) / 2,
            width: timeToPixelX(viewport, brushRect.timeEnd) - timeToPixelX(viewport, brushRect.timeStart),
            height: trackRowHeight(viewport) * (brushRect.trackMax - brushRect.trackMin + 1),
            border: "1px solid rgba(13, 15, 20, 0.55)",
            background: "rgba(13, 15, 20, 0.10)",
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />
      )}
      {a11y.regions()}
    </div>
  );
}
