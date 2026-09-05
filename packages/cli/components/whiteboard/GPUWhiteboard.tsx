import { createPointerController, createViewportController, normalizeWheel } from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { WhiteboardComponent } from "./WhiteboardComponent.ts";
import type { WhiteboardData, WhiteboardShape } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;

export interface GPUWhiteboardProps {
  readonly data: WhiteboardData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly hoveredId?: string | null;
  readonly onHover?: (id: string | null) => void;
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
 * Phase 1: pan, zoom, and exact CPU hover over a static board — no draw tools, no select/move yet
 * (those are phases 2-3, following the same pointer-lifecycle machine `registry/annotationcanvas`'s
 * `tools.ts` already proved). `onHover`/`a11y.announce` are read through refs inside the pointer
 * effect rather than named in its dependency array — a lesson paid for once already this session in
 * `GPUNodeEditor`/`GPUDepGraph`/`GPUScatter`: `useGpuA11y()` returns a new wrapper object every
 * render, and naming it (or an inline consumer callback) in a pointer effect's deps tears the effect
 * down and reattaches it on any mid-gesture re-render, silently resetting closured drag state.
 */
export function GPUWhiteboard(props: GPUWhiteboardProps): JSX.Element {
  const { data, onViewportChange, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;

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

  const componentRef = useRef<WhiteboardComponent | null>(null);
  const factory = useCallback(() => {
    const component = new WhiteboardComponent();
    componentRef.current = component;
    return component;
  }, []);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({ shapes: data.shapes, viewport, hoveredId: props.hoveredId }),
      [data.shapes, viewport, props.hoveredId],
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
        const controller = createViewportController(viewportRef.current, boundsRef.current);
        controller.panByPixels(-(state.x - dragFrom.x), -(state.y - dragFrom.y));
        dragFrom = { x: state.x, y: state.y };
        setViewportRef.current(controller.getState());
        onHoverRef.current?.(null);
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHoverRef.current?.(hit ? String(hit.id) : null);
    });

    const unsubLeave = pointer.onLeave(() => onHoverRef.current?.(null));

    const unsubUp = pointer.onUp((state) => {
      const start = dragFrom;
      dragFrom = null;
      if (start && Math.abs(state.x - start.x) < 3 && Math.abs(state.y - start.y) < 3) {
        const hit = componentRef.current?.hitTest(state.x, state.y);
        if (hit) announceRef.current(describeShape(data.shapes, String(hit.id)));
      }
    });

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
    return () => {
      unsubDown();
      unsubMove();
      unsubUp();
      unsubLeave();
      detach();
      el.removeEventListener("wheel", onWheel);
    };
  }, [canvas, data]);

  return (
    <div
      {...a11y.rootProps}
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        aria-hidden="true"
        ref={setCanvas}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: "grab" }}
      />
      {status === "unsupported" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
          WebGPU unavailable.
        </div>
      )}
      {a11y.regions()}
      {props.hoveredId != null && <div style={SR_ONLY}>{describeShape(data.shapes, props.hoveredId)}</div>}
    </div>
  );
}
