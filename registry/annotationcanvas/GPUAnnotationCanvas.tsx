import {
  createPointerController,
  createViewportController,
  normalizeWheel,
  pixelXToTime,
  pixelYToTrack,
  timeToPixelX,
  trackToPixelY,
} from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { LabelOverlay, SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import type { PositionedLabel } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { AnnotationCanvasComponent, type AnnotationColormap } from "./AnnotationCanvasComponent.ts";
import { areaEllipse, areaPolygon, areaRect, lengthOf, type Point2D } from "./measure.ts";
import type { Annotation } from "./scene.ts";
import { createToolController, moveAnnotation, type ImagePoint, type ToolController, type ToolName } from "./tools.ts";
import type { FieldData } from "./ingest.ts";

/** Wheel pixels → zoom factor, matching `GPUHeatmap`/`GPUScatter`'s feel. */
const ZOOM_SPEED = 0.0015;
/** Measurement labels are real DOM text (§21.1's overlay); this is the same measured DOM budget
 * `GPUHeatmap`'s headers use, applied to the design doc's "cap ~100" for annotation labels. */
const MAX_MEASUREMENT_LABELS = 100;
/** Fraction of the visible span, on each axis, that still counts as "nearby" for a measurement
 * label — an annotation just off-screen keeps its label rather than popping in only once fully
 * visible. */
const NEARBY_MARGIN_FRACTION = 0.15;

export interface GPUAnnotationCanvasProps {
  readonly field: FieldData;
  readonly annotations: readonly Annotation[];
  /** Active draw/interaction tool. Defaults to `"pan"`. */
  readonly tool?: ToolName;
  /** x maps image columns, y maps image rows — continuous, like the underlying component's viewport. */
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly window?: { readonly min: number; readonly max: number };
  readonly colormap?: AnnotationColormap;
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string | null) => void;
  /** A draw tool finished a gesture and produced a new annotation — the host decides whether/how
   * to add it to `annotations` (hybrid ownership, per the design doc). */
  readonly onCreate?: (annotation: Annotation) => void;
  /** The "select" tool moved the selected annotation, or a host edit elsewhere wants to commit
   * a changed geometry. */
  readonly onChange?: (annotation: Annotation) => void;
  /** Delete/Backspace with a selection active. */
  readonly onDelete?: (id: string) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

function boundsFor(field: FieldData): ViewportBounds {
  return { timeMin: 0, timeMax: field.width, rowMin: 0, rowMax: field.height };
}

const KIND_LABEL: Record<Annotation["kind"], string> = {
  rect: "rectangle",
  ellipse: "ellipse",
  point: "point",
  ruler: "ruler",
  polygon: "polygon",
  freehand: "freehand",
};

function countsByKind(annotations: readonly Annotation[]): string {
  const counts = new Map<string, number>();
  for (const a of annotations) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  if (counts.size === 0) return "no annotations";
  return Array.from(counts.entries())
    .map(([kind, n]) => `${n} ${KIND_LABEL[kind as Annotation["kind"]]}${n === 1 ? "" : "s"}`)
    .join(", ");
}

/** The measurement text the design doc asks for: ruler → length, rect/ellipse/polygon → area
 * (rect also states its width×height). Point/freehand have no defined measurement in v1. */
function measurementText(a: Annotation): string | null {
  switch (a.kind) {
    case "rect":
      return `${a.w.toFixed(1)} × ${a.h.toFixed(1)} (${areaRect(a.w, a.h).toFixed(1)})`;
    case "ellipse":
      return areaEllipse(a.w, a.h).toFixed(1);
    case "ruler":
      return lengthOf(a.x0, a.y0, a.x1, a.y1).toFixed(1);
    case "polygon":
      return a.points.length >= 3 ? areaPolygon(a.points).toFixed(1) : null;
    case "point":
    case "freehand":
      return null;
  }
}

function measurementAnchor(a: Annotation): Point2D {
  switch (a.kind) {
    case "rect":
    case "ellipse":
      return { x: a.x + a.w / 2, y: a.y };
    case "point":
      return { x: a.x, y: a.y };
    case "ruler":
      return { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2 };
    case "polygon":
    case "freehand": {
      const pts = a.points;
      if (pts.length === 0) return { x: 0, y: 0 };
      let sx = 0;
      let sy = 0;
      for (const p of pts) {
        sx += p.x;
        sy += p.y;
      }
      return { x: sx / pts.length, y: sy / pts.length };
    }
  }
}

function annotationNearby(a: Annotation, timeMin: number, timeMax: number, rowMin: number, rowMax: number): boolean {
  const anchor = measurementAnchor(a);
  return anchor.x >= timeMin && anchor.x <= timeMax && anchor.y >= rowMin && anchor.y <= rowMax;
}

function describeAnnotation(a: Annotation): string {
  const text = measurementText(a);
  return text ? `${KIND_LABEL[a.kind]}: ${text}` : KIND_LABEL[a.kind];
}

/**
 * `GPUAnnotationCanvas` — the design doc's medical/scientific field viewer: a colormapped Float32
 * field plus a retained annotation overlay, with pan/zoom adapted from `GPUHeatmap`/`GPUScatter`
 * and a tool state machine (`tools.ts`) turning pointer gestures into `onCreate`/`onChange` events.
 *
 * Interaction is hybrid, matching the locked plan: `annotations` are fully host-owned props, and
 * this component never mutates them — every gesture becomes an event the host applies (or not).
 *
 * Measurement labels (ruler length, rect/ellipse/polygon area) render through the shared `LabelOverlay`
 * (§21.1), so they cannot drift from the shapes they describe; capped at `MAX_MEASUREMENT_LABELS` to
 * the design doc's "cap ~100", prioritizing the current selection over nearby-but-unselected shapes.
 */
export function GPUAnnotationCanvas(props: GPUAnnotationCanvasProps): JSX.Element {
  const { field, annotations, onViewportChange, onSelect, onCreate, onChange, onDelete, style, className } = props;
  const tool = props.tool ?? "pan";
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const bounds = useMemo(() => boundsFor(field), [field]);

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const selectedIdRef = useRef(props.selectedId ?? null);
  selectedIdRef.current = props.selectedId ?? null;

  const [draft, setDraft] = useState<Annotation | null>(null);

  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Annotation canvas",
    summary:
      `${field.width} by ${field.height} field, window ${field.window.min.toFixed(3)} to ${field.window.max.toFixed(3)}. ` +
      `${countsByKind(annotations)}.`,
  });
  const announce = a11y.announce;

  const setViewport = useCallback(
    (next: ViewportState) => {
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    },
    [onViewportChange],
  );
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;

  const componentRef = useRef<AnnotationCanvasComponent | null>(null);
  const factory = useCallback(() => {
    const component = new AnnotationCanvasComponent();
    componentRef.current = component;
    return component;
  }, []);

  const displayAnnotations = useMemo(
    () => (draft ? [...annotations, draft] : annotations),
    [annotations, draft],
  );

  const componentProps = useMemo(
    () => ({
      field,
      annotations: displayAnnotations,
      viewport,
      window: props.window,
      colormap: props.colormap,
      selectedId: props.selectedId ?? null,
    }),
    [field, displayAnnotations, viewport, props.window, props.colormap, props.selectedId],
  );
  useGpuComponent(factory, canvas, componentProps);

  // The active tool's pointer-lifecycle state machine — recreated whenever the tool changes, so a
  // half-finished drag/polygon never leaks into the next tool.
  const toolCtrlRef = useRef<ToolController>(createToolController(tool));
  useEffect(() => {
    toolCtrlRef.current.cancel();
    toolCtrlRef.current = createToolController(tool);
    setDraft(null);
  }, [tool]);

  const toImagePoint = useCallback((v: ViewportState, screenX: number, screenY: number): ImagePoint => {
    return { x: pixelXToTime(v, screenX), y: pixelYToTrack(v, screenY) };
  }, []);

  /**
   * Pointer and wheel, attached natively (not React's synthetic events) so `preventDefault()` can
   * stop page-scroll while panning/zooming — the same reasoning `GPUHeatmap`/`GPUScatter` give.
   */
  useEffect(() => {
    const el = canvas;
    if (!el) return;

    const pointer = createPointerController();
    const detachPointer = pointer.attach(el);
    let panFrom: { x: number; y: number } | null = null;
    // "select" tool: the annotation being moved, captured at pointer-down so every move computes
    // its delta from the original geometry rather than compounding onChange calls.
    let moving: { id: string; origin: Annotation; start: ImagePoint } | null = null;

    const unsubDown = pointer.onDown((state) => {
      if (tool === "pan") {
        panFrom = { x: state.x, y: state.y };
        return;
      }
      if (tool === "select") {
        const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
        if (hit) {
          const id = String(hit.id);
          onSelect?.(id);
          const origin = annotationsRef.current.find((a) => a.id === id) ?? null;
          if (origin) {
            moving = { id, origin, start: toImagePoint(viewportRef.current, state.x, state.y) };
          }
        } else {
          moving = null;
        }
        return;
      }
      const p = toImagePoint(viewportRef.current, state.x, state.y);
      toolCtrlRef.current.onPointerDown(p);
      setDraft(toolCtrlRef.current.draft);
    });

    const unsubMove = pointer.onMove((state) => {
      if (tool === "pan") {
        if (panFrom && state.dragging) {
          const controller = createViewportController(viewportRef.current, boundsRef.current);
          controller.panByPixels(-(state.x - panFrom.x), -(state.y - panFrom.y));
          panFrom = { x: state.x, y: state.y };
          setViewportRef.current(controller.getState());
        }
        return;
      }
      if (tool === "select") {
        if (moving && state.dragging) {
          const current = toImagePoint(viewportRef.current, state.x, state.y);
          const dx = current.x - moving.start.x;
          const dy = current.y - moving.start.y;
          onChange?.(moveAnnotation(moving.origin, dx, dy));
        }
        return;
      }
      const p = toImagePoint(viewportRef.current, state.x, state.y);
      toolCtrlRef.current.onPointerMove(p);
      setDraft(toolCtrlRef.current.draft);
    });

    const unsubUp = pointer.onUp((state) => {
      if (tool === "pan") {
        panFrom = null;
        return;
      }
      if (tool === "select") {
        const wasMoving = moving !== null;
        moving = null;
        if (!wasMoving) {
          // A click that missed every annotation clears the selection.
          const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
          if (!hit) onSelect?.(null);
        }
        return;
      }
      const p = toImagePoint(viewportRef.current, state.x, state.y);
      const finished = toolCtrlRef.current.onPointerUp(p);
      setDraft(toolCtrlRef.current.draft);
      if (finished) {
        onCreate?.(finished);
        const text = measurementText(finished);
        announce(text ? `Created ${KIND_LABEL[finished.kind]}: ${text}` : `Created ${KIND_LABEL[finished.kind]}`);
      }
    });

    const onDblClick = () => {
      if (tool !== "polygon") return;
      const finished = toolCtrlRef.current.finish();
      setDraft(toolCtrlRef.current.draft);
      if (finished) {
        onCreate?.(finished);
        announce(describeAnnotation(finished));
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaX, deltaY } = normalizeWheel(e);
      const controller = createViewportController(viewportRef.current, boundsRef.current);

      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(deltaY * ZOOM_SPEED);
        controller.zoomAt(e.clientX - rect.left, factor);
        controller.zoomAtY(e.clientY - rect.top, factor);
      } else {
        controller.panByPixels(-deltaX, -deltaY);
      }
      setViewportRef.current(controller.getState());
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDblClick);
    return () => {
      unsubDown();
      unsubMove();
      unsubUp();
      detachPointer();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDblClick);
    };
  }, [canvas, tool, onSelect, onCreate, onChange, announce, toImagePoint]);

  /** Escape cancels an in-progress draft (or a polygon session); Enter closes a polygon; Delete
   * removes the current selection — the design doc's remaining keyboard affordances. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        toolCtrlRef.current.cancel();
        setDraft(null);
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && tool === "polygon") {
        const finished = toolCtrlRef.current.finish();
        setDraft(null);
        if (finished) {
          onCreate?.(finished);
          announce(describeAnnotation(finished));
        }
        e.preventDefault();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIdRef.current) {
        onDelete?.(selectedIdRef.current);
        announce("Annotation deleted");
        e.preventDefault();
      }
    },
    [tool, onCreate, onDelete, announce],
  );

  // Measurement labels: real DOM text over the selected annotation plus every other one whose
  // anchor is visible or just off-screen, capped to the measured DOM-label budget (§21.1, §13.4).
  const measurementLabels: PositionedLabel[] = useMemo(() => {
    const [timeMin, timeMax] = [viewport.timeStart, viewport.timeEnd];
    const rowStart = viewport.rowStart ?? 0;
    const rowEnd = viewport.rowEnd ?? viewport.trackCount;
    const marginX = (timeMax - timeMin) * NEARBY_MARGIN_FRACTION;
    const marginY = (rowEnd - rowStart) * NEARBY_MARGIN_FRACTION;

    const selectedId = props.selectedId ?? null;
    const candidates = displayAnnotations.filter((a) => {
      if (a.id === selectedId) return true;
      return annotationNearby(a, timeMin - marginX, timeMax + marginX, rowStart - marginY, rowEnd + marginY);
    });

    // The selection always keeps its label even past the cap; everything else fills what's left.
    const selected = candidates.filter((a) => a.id === selectedId);
    const rest = candidates.filter((a) => a.id !== selectedId).slice(0, Math.max(0, MAX_MEASUREMENT_LABELS - selected.length));

    const labels: PositionedLabel[] = [];
    for (const a of [...selected, ...rest]) {
      const text = measurementText(a);
      if (!text) continue;
      const anchor = measurementAnchor(a);
      labels.push({
        key: a.id,
        text,
        ariaLabel: describeAnnotation(a),
        left: timeToPixelX(viewport, anchor.x) + 4,
        top: trackToPixelY(viewport, anchor.y) - 16,
      });
    }
    return labels;
  }, [displayAnnotations, viewport, props.selectedId]);

  const selectedAnnotation = useMemo(
    () => (props.selectedId ? annotations.find((a) => a.id === props.selectedId) ?? null : null),
    [annotations, props.selectedId],
  );

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
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor: tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair",
        }}
      />
      {status === "unsupported" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
          WebGPU unavailable.
        </div>
      )}

      <LabelOverlay labels={measurementLabels} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }} />

      {a11y.regions()}
      {selectedAnnotation && <div style={SR_ONLY}>Selected {describeAnnotation(selectedAnnotation)}</div>}
    </div>
  );
}
