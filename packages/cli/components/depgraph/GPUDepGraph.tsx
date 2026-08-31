import {
  createPointerController,
  createViewportController,
  normalizeWheel,
  timeToPixelX,
  trackToPixelY,
} from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { LabelOverlay, SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import type { PositionedLabel } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { DepGraphComponent } from "./DepGraphComponent.ts";
import type { DepGraphData } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;
const MAX_LABELS = 200;
const MIN_LABEL_PX = 10;

export interface GPUDepGraphProps {
  readonly data: DepGraphData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly hoveredNode?: number | null;
  readonly selectedNode?: number | null;
  readonly onHoverNode?: (index: number | null) => void;
  readonly onSelectNode?: (index: number | null) => void;
  readonly nodeSizePx?: number;
  readonly edgeWidthPx?: number;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

function describeNode(data: DepGraphData, index: number): string {
  const label = data.labels[index] ?? `node ${index}`;
  const rank = data.ranks[index];
  return `${label}, layer ${rank}`;
}

/**
 * `GPUDepGraph` — Sugiyama layered dependency graph with orthogonal edges.
 *
 * Positions are fixed after ingest; pan/zoom and hover are CPU-side against the layout buffers.
 */
export function GPUDepGraph(props: GPUDepGraphProps): JSX.Element {
  const { data, onViewportChange, onHoverNode, onSelectNode, style, className } = props;
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
    label: props["aria-label"] ?? "Dependency graph",
    summary:
      `${data.nodeCount.toLocaleString("en-US")} nodes, ${data.edgeCount.toLocaleString("en-US")} edges, ` +
      `${data.segments.length.toLocaleString("en-US")} orthogonal segments.`,
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

  const componentRef = useRef<DepGraphComponent | null>(null);
  const factory = useCallback(() => {
    const component = new DepGraphComponent();
    componentRef.current = component;
    return component;
  }, []);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({
        data,
        viewport,
        hoveredNode: props.hoveredNode,
        selectedNode: props.selectedNode,
        nodeSizePx: props.nodeSizePx,
        edgeWidthPx: props.edgeWidthPx,
      }),
      [data, viewport, props.hoveredNode, props.selectedNode, props.nodeSizePx, props.edgeWidthPx],
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
        onHoverNode?.(null);
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHoverNode?.(hit ? Number(hit.id) : null);
    });

    const unsubLeave = pointer.onLeave(() => onHoverNode?.(null));

    const unsubUp = pointer.onUp((state) => {
      const start = dragFrom;
      dragFrom = null;
      if (start && Math.abs(state.x - start.x) < 3 && Math.abs(state.y - start.y) < 3) {
        const hit = componentRef.current?.hitTest(state.x, state.y);
        const id = hit ? Number(hit.id) : null;
        onSelectNode?.(id);
        if (id != null) a11y.announce(describeNode(data, id));
      }
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaY } = normalizeWheel(e);
      const factor = Math.exp(deltaY * ZOOM_SPEED);
      const controller = createViewportController(viewportRef.current, boundsRef.current);
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
  }, [canvas, data, onHoverNode, onSelectNode, a11y]);

  const labels: PositionedLabel[] = useMemo(() => {
    const out: PositionedLabel[] = [];
    const spanX = viewport.timeEnd - viewport.timeStart;
    const nodePx = viewport.width / Math.max(data.nodeCount, 1);
    if (nodePx < MIN_LABEL_PX && spanX > (data.bounds.xMax - data.bounds.xMin) * 0.5) {
      return out;
    }
    for (let i = 0; i < data.nodeCount && out.length < MAX_LABELS; i++) {
      const x = data.x[i]!;
      const y = data.y[i]!;
      if (x < viewport.timeStart || x > viewport.timeEnd) continue;
      const [y0, y1] = [viewport.rowStart ?? 0, viewport.rowEnd ?? viewport.trackCount];
      if (y < y0 || y > y1) continue;
      out.push({
        key: `n${i}`,
        text: data.labels[i] ?? String(i),
        ariaLabel: describeNode(data, i),
        left: timeToPixelX(viewport, x) + 10,
        top: trackToPixelY(viewport, y) - 6,
      });
    }
    return out;
  }, [data, viewport]);

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
      <LabelOverlay labels={labels} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)", fontSize: 11 }} />
      {a11y.regions()}
      {props.hoveredNode != null && (
        <div style={SR_ONLY}>{describeNode(data, props.hoveredNode)}</div>
      )}
    </div>
  );
}
