import { createPointerController, createViewportController, normalizeWheel, pixelXToTime, pixelYToTrack } from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX, KeyboardEvent as ReactKeyboardEvent } from "react";
import { WhiteboardComponent } from "./WhiteboardComponent.ts";
import type { WhiteboardData, WhiteboardShape } from "./ingest.ts";
import { boundsIntersect, shapeBounds } from "./scene.ts";
import { createToolController, moveShape, type DomainPoint, type ToolController, type ToolName } from "./tools.ts";

const ZOOM_SPEED = 0.0015;
/** A press that moves less than this is a click, not a drag — matches `GPUNodeEditor`'s threshold. */
const DRAG_THRESHOLD_PX = 4;

const EMPTY_SET: ReadonlySet<string> = new Set();

/** `"select"` covers pan, click-select, shift-click multi-select, marquee-drag, and move-by-drag —
 * everything `GPUNodeEditor` does without a dedicated tool. Every other value hands pointer events
 * to `tools.ts`'s draw-tool state machine instead, matching `GPUAnnotationCanvas`. */
export type WhiteboardTool = "select" | ToolName;

type DragState =
  | { readonly kind: "pan"; readonly startPx: number; readonly startPy: number }
  | { readonly kind: "move"; readonly start: DomainPoint; readonly origins: ReadonlyMap<string, WhiteboardShape> }
  | { readonly kind: "marquee"; readonly startPx: number; readonly startPy: number };

export interface GPUWhiteboardProps {
  readonly data: WhiteboardData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  /** Active tool. Defaults to `"select"` — pan/hover/select/move/marquee, unchanged from phase 1
   * when nothing else is going on. */
  readonly tool?: WhiteboardTool;
  readonly hoveredId?: string | null;
  readonly onHover?: (id: string | null) => void;
  /** Fires whenever the (internally-held) selection changes — click, shift-click, marquee, or a
   * delete clearing it. Informational, not a controlled prop, mirroring `GPUNodeEditor`'s
   * `onSelectionChange`: selection is interaction state owned by this component. */
  readonly onSelectionChange?: (ids: ReadonlySet<string>) => void;
  /** A draw tool finished a gesture and produced a new shape — the host decides whether/how to add
   * it to `data.shapes` (hybrid ownership, same as `GPUAnnotationCanvas`'s `onCreate`). */
  readonly onCreate?: (shape: WhiteboardShape) => void;
  /** The select tool moved a shape (once per moved shape per pointer move, so a multi-selection
   * drag calls this once for each member — the host applies each to its own `data.shapes`). */
  readonly onChange?: (shape: WhiteboardShape) => void;
  /** Delete/Backspace with a selection active. */
  readonly onDelete?: (ids: readonly string[]) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

const KIND_LABEL: Record<WhiteboardShape["kind"], string> = {
  rect: "rectangle",
  ellipse: "ellipse",
  point: "point",
  ruler: "ruler",
  polygon: "polygon",
  freehand: "freehand",
};

function countsByKind(shapes: readonly WhiteboardShape[]): string {
  const counts = new Map<string, number>();
  for (const s of shapes) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  if (counts.size === 0) return "empty board";
  return Array.from(counts.entries())
    .map(([kind, n]) => `${n} ${KIND_LABEL[kind as WhiteboardShape["kind"]]}${n === 1 ? "" : "s"}`)
    .join(", ");
}

function describeShape(shapes: readonly WhiteboardShape[], id: string): string {
  const shape = shapes.find((s) => s.id === id);
  return shape ? KIND_LABEL[shape.kind] : id;
}

/**
 * `GPUWhiteboard` — freeform infinite canvas (PLAN.md #14).
 *
 * Draw tools (`tools.ts`, forked from `GPUAnnotationCanvas`) turn a pointer gesture into a new
 * shape via `onCreate`. The `"select"` tool (default) reuses `GPUNodeEditor`'s proven pattern
 * instead: click selects, shift-click toggles into a multi-selection, a drag on empty space either
 * pans (plain) or marquee-selects (shift), and dragging a selected shape moves the whole selection.
 * Delete/Backspace removes the current selection. Shapes stay host-owned throughout — this
 * component never mutates `data.shapes`, only emits events describing what the gesture wants to
 * happen, the same hybrid-ownership contract `GPUAnnotationCanvas` established for the identical
 * six shape kinds.
 *
 * `onHover`/`onCreate`/`onChange`/`onDelete`/`a11y.announce` are read through refs inside the
 * pointer effect rather than named in its dependency array — the lesson paid for repeatedly
 * elsewhere in this repo (`GPUNodeEditor`, `GPUDepGraph`, `GPUScatter`, this component's own phase
 * 1): `useGpuA11y()` returns a new wrapper object every render, and naming it (or an inline
 * consumer callback) in a pointer effect's deps tears the effect down and reattaches it on any
 * mid-gesture re-render, silently resetting closured drag state.
 */
export function GPUWhiteboard(props: GPUWhiteboardProps): JSX.Element {
  const { data, onViewportChange, style, className } = props;
  const tool = props.tool ?? "select";
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [draft, setDraft] = useState<WhiteboardShape | null>(null);

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
    label: props["aria-label"] ?? "Whiteboard",
    summary: countsByKind(data.shapes),
  });
  const announceRef = useRef(a11y.announce);
  announceRef.current = a11y.announce;
  const onHoverRef = useRef(props.onHover);
  onHoverRef.current = props.onHover;
  const onCreateRef = useRef(props.onCreate);
  onCreateRef.current = props.onCreate;
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const onDeleteRef = useRef(props.onDelete);
  onDeleteRef.current = props.onDelete;

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const shapesRef = useRef(data.shapes);
  shapesRef.current = data.shapes;

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const applySelection = useCallback(
    (next: ReadonlySet<string>) => {
      setSelectedIds(next);
      props.onSelectionChange?.(next);
    },
    [props.onSelectionChange],
  );
  const applySelectionRef = useRef(applySelection);
  applySelectionRef.current = applySelection;

  const setViewport = useCallback(
    (next: ViewportState) => {
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    },
    [onViewportChange],
  );
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;

  const componentRef = useRef<WhiteboardComponent | null>(null);
  const factory = useCallback(() => {
    const component = new WhiteboardComponent();
    componentRef.current = component;
    return component;
  }, []);

  // The active draw tool's pointer-lifecycle state machine — recreated whenever the tool changes
  // (including switching to/from "select"), so a half-finished drag/polygon never leaks across tools.
  const toolCtrlRef = useRef<ToolController | null>(null);
  useEffect(() => {
    toolCtrlRef.current?.cancel();
    toolCtrlRef.current = tool === "select" ? null : createToolController(tool);
    setDraft(null);
  }, [tool]);

  // Shift is the selection modifier everywhere, same convention `GPUNodeEditor` uses: shift-click
  // toggles a shape into/out of the selection, shift-drag on empty canvas marquee-selects.
  const shiftRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const displayShapes = useMemo(() => (draft ? [...data.shapes, draft] : data.shapes), [data.shapes, draft]);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({ shapes: displayShapes, viewport, hoveredId: props.hoveredId, selectedIds }),
      [displayShapes, viewport, props.hoveredId, selectedIds],
    ),
  );

  const toDomainPoint = useCallback((v: ViewportState, screenX: number, screenY: number): DomainPoint => {
    return { x: pixelXToTime(v, screenX), y: pixelYToTrack(v, screenY) };
  }, []);

  useEffect(() => {
    const el = canvas;
    if (!el) return;
    const pointer = createPointerController();
    const detach = pointer.attach(el);
    let drag: DragState | null = null;

    const unsubDown = pointer.onDown((state) => {
      if (tool !== "select") {
        const p = toDomainPoint(viewportRef.current, state.x, state.y);
        toolCtrlRef.current?.onPointerDown(p);
        setDraft(toolCtrlRef.current?.draft ?? null);
        return;
      }

      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      if (hit) {
        const id = String(hit.id);
        if (shiftRef.current) {
          const next = new Set(selectedIdsRef.current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          applySelectionRef.current(next);
          drag = null;
          return;
        }
        const activeSelection = selectedIdsRef.current.has(id) ? selectedIdsRef.current : new Set([id]);
        if (activeSelection !== selectedIdsRef.current) applySelectionRef.current(activeSelection);
        const origins = new Map<string, WhiteboardShape>();
        for (const sid of activeSelection) {
          const shape = shapesRef.current.find((s) => s.id === sid);
          if (shape) origins.set(sid, shape);
        }
        drag = { kind: "move", start: toDomainPoint(viewportRef.current, state.x, state.y), origins };
        return;
      }

      drag = shiftRef.current
        ? { kind: "marquee", startPx: state.x, startPy: state.y }
        : { kind: "pan", startPx: state.x, startPy: state.y };
    });

    const unsubMove = pointer.onMove((state) => {
      if (tool !== "select") {
        const p = toDomainPoint(viewportRef.current, state.x, state.y);
        toolCtrlRef.current?.onPointerMove(p);
        setDraft(toolCtrlRef.current?.draft ?? null);
        return;
      }

      if (drag?.kind === "pan" && state.dragging) {
        const controller = createViewportController(viewportRef.current, boundsRef.current);
        controller.panByPixels(-(state.x - drag.startPx), -(state.y - drag.startPy));
        drag = { kind: "pan", startPx: state.x, startPy: state.y };
        setViewportRef.current(controller.getState());
        onHoverRef.current?.(null);
        return;
      }
      if (drag?.kind === "move" && state.dragging) {
        const current = toDomainPoint(viewportRef.current, state.x, state.y);
        const dx = current.x - drag.start.x;
        const dy = current.y - drag.start.y;
        for (const origin of drag.origins.values()) onChangeRef.current?.(moveShape(origin, dx, dy));
        onHoverRef.current?.(null);
        return;
      }
      if (drag?.kind === "marquee" && state.dragging) {
        setMarquee({ x0: drag.startPx, y0: drag.startPy, x1: state.x, y1: state.y });
        onHoverRef.current?.(null);
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHoverRef.current?.(hit ? String(hit.id) : null);
    });

    const unsubLeave = pointer.onLeave(() => onHoverRef.current?.(null));

    const unsubUp = pointer.onUp((state) => {
      if (tool !== "select") {
        const p = toDomainPoint(viewportRef.current, state.x, state.y);
        const finished = toolCtrlRef.current?.onPointerUp(p) ?? null;
        setDraft(toolCtrlRef.current?.draft ?? null);
        if (finished) {
          onCreateRef.current?.(finished);
          announceRef.current(`Created ${KIND_LABEL[finished.kind]}`);
        }
        return;
      }

      const finished = drag;
      drag = null;
      if (!finished) return;

      if (finished.kind === "move") return; // onChange already fired live, during the drag

      if (finished.kind === "marquee") {
        setMarquee(null);
        const v = viewportRef.current;
        const box = {
          xMin: pixelXToTime(v, Math.min(finished.startPx, state.x)),
          xMax: pixelXToTime(v, Math.max(finished.startPx, state.x)),
          yMin: pixelYToTrack(v, Math.min(finished.startPy, state.y)),
          yMax: pixelYToTrack(v, Math.max(finished.startPy, state.y)),
        };
        const found = new Set<string>();
        for (const shape of shapesRef.current) {
          if (boundsIntersect(shapeBounds(shape), box)) found.add(shape.id);
        }
        const next = shiftRef.current ? new Set([...selectedIdsRef.current, ...found]) : found;
        applySelectionRef.current(next);
        announceRef.current(`${found.size} shape${found.size === 1 ? "" : "s"} selected`);
        return;
      }

      // "pan": a plain drag that barely moved is a click on empty canvas, clearing the selection.
      const dragDist = Math.hypot(state.x - finished.startPx, state.y - finished.startPy);
      if (dragDist < DRAG_THRESHOLD_PX && selectedIdsRef.current.size > 0) applySelectionRef.current(EMPTY_SET);
    });

    const onDblClick = () => {
      if (tool !== "polygon") return;
      const finished = toolCtrlRef.current?.finish() ?? null;
      setDraft(toolCtrlRef.current?.draft ?? null);
      if (finished) {
        onCreateRef.current?.(finished);
        announceRef.current(`Created ${KIND_LABEL[finished.kind]}`);
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
      unsubLeave();
      detach();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDblClick);
    };
  }, [canvas, tool, toDomainPoint]);

  /** Escape cancels an in-progress draft; Enter closes a polygon; Delete/Backspace removes the
   * current selection — the same keyboard affordances `GPUAnnotationCanvas`/`GPUNodeEditor` give. */
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        toolCtrlRef.current?.cancel();
        setDraft(null);
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && tool === "polygon") {
        const finished = toolCtrlRef.current?.finish() ?? null;
        setDraft(null);
        if (finished) {
          props.onCreate?.(finished);
          a11y.announce(`Created ${KIND_LABEL[finished.kind]}`);
        }
        e.preventDefault();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
        const ids = [...selectedIds];
        applySelection(EMPTY_SET);
        props.onDelete?.(ids);
        a11y.announce(`Deleted ${ids.length} shape${ids.length === 1 ? "" : "s"}`);
        e.preventDefault();
      }
    },
    [tool, selectedIds, applySelection, props.onCreate, props.onDelete, a11y],
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
          cursor: tool === "select" ? "grab" : "crosshair",
        }}
      />
      {status === "unsupported" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
          WebGPU unavailable.
        </div>
      )}
      {marquee && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
            border: "1px solid rgba(59,211,232,0.7)",
            background: "rgba(59,211,232,0.12)",
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />
      )}
      {a11y.regions()}
      {props.hoveredId != null && <div style={SR_ONLY}>{describeShape(data.shapes, props.hoveredId)}</div>}
    </div>
  );
}
