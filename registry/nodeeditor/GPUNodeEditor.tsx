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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { NodeEditorComponent } from "./NodeEditorComponent.ts";
import { portPosition, type NodeEditorData, type PortRef } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;
const MAX_LABELS = 200;
const MIN_LABEL_PX = 28;
/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

const EMPTY_SET: ReadonlySet<number> = new Set();

type DragState =
  | { readonly kind: "pan"; readonly startPx: number; readonly startPy: number }
  | {
      readonly kind: "node";
      readonly id: number;
      readonly startPx: number;
      readonly startPy: number;
      readonly startX: number;
      readonly startY: number;
    }
  | { readonly kind: "connect"; readonly from: PortRef; readonly startPx: number; readonly startPy: number }
  | { readonly kind: "marquee"; readonly startPx: number; readonly startPy: number };

export interface GPUNodeEditorProps {
  /**
   * Mutated in place by dragging, connecting, and deleting (`NodeEditorComponent`'s methods write
   * straight into `data`'s fields — see its doc comment). Keep this object stable across renders,
   * the same rule `GPUSpreadsheet`'s `initialCells` note follows for its own uncontrolled state:
   * re-`ingestNodeEditor()`-ing on every render would discard whatever the user just did.
   */
  readonly data: NodeEditorData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly hoveredNode?: number | null;
  readonly onHoverNode?: (index: number | null) => void;
  /** Fires whenever the (internally-held) selection changes — click, shift-click, marquee, or a
   * delete clearing it. Informational, not a controlled prop: selection here is interaction state
   * as involved as `GPUSpreadsheet`'s, so it lives in this component, not the caller. */
  readonly onSelectionChange?: (nodes: ReadonlySet<number>, edges: ReadonlySet<number>) => void;
  /** Fires once, when a node drag ends (not per pointermove) — the moment to persist a layout. */
  readonly onNodeMove?: (index: number, x: number, y: number) => void;
  /** Fires once a drag-to-connect gesture completes on a compatible port. */
  readonly onConnect?: (source: number, target: number) => void;
  /** Fires once, after a Delete/Backspace removes the current selection. */
  readonly onDelete?: (nodes: readonly number[], edges: readonly number[]) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

function describeNode(data: NodeEditorData, index: number): string {
  const label = data.labels[index] ?? `node ${index}`;
  const inDeg = data.inDegree[index] ?? 0;
  const outDeg = data.outDegree[index] ?? 0;
  return `${label}, ${inDeg} incoming and ${outDeg} outgoing connections`;
}

/**
 * `GPUNodeEditor` — freeform node-flow canvas (PLAN.md #13).
 *
 * Every mutation — move, connect, delete — bypasses React state while it happens:
 * `NodeEditorComponent`'s methods write straight into `data`'s fields and re-upload, the same
 * "push to a ref" discipline `GPUGraph`'s progress callback and `GPUScatter`'s `setSelection()` use
 * for anything that must happen every frame of an interaction. The only React state a drag touches
 * is `labelTick`, below, which exists purely to make the DOM title overlay re-read the (mutated)
 * position arrays each move — the GPU canvas updates regardless, since the component sets its own
 * `dirty` flag.
 *
 * Modifier convention: **Shift is the selection modifier**, everywhere. Shift-click a node or edge
 * toggles it into/out of the selection instead of starting a drag; shift-drag on empty canvas
 * marquee-selects instead of panning; a plain drag on empty canvas still pans, unchanged from
 * phase 1. This mirrors how Shift already reads as "selection-related" in the rest of the library
 * (`GPUSpreadsheet`'s extend-selection modifier).
 */
export function GPUNodeEditor(props: GPUNodeEditorProps): JSX.Element {
  const { data, onViewportChange, onSelectionChange, onDelete, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  /** Bumped on every `pointermove` of a node drag — see the doc comment above. */
  const [labelTick, bumpLabelTick] = useReducer((n: number) => n + 1, 0);

  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<number>>(EMPTY_SET);
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<number>>(EMPTY_SET);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

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
    label: props["aria-label"] ?? "Node editor",
    summary: `${data.nodeCount.toLocaleString("en-US")} nodes, ${data.edgeCount.toLocaleString("en-US")} connections.`,
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

  const selectedNodesRef = useRef(selectedNodes);
  selectedNodesRef.current = selectedNodes;
  const selectedEdgesRef = useRef(selectedEdges);
  selectedEdgesRef.current = selectedEdges;

  const applySelection = useCallback(
    (nodes: ReadonlySet<number>, edges: ReadonlySet<number>) => {
      setSelectedNodes(nodes);
      setSelectedEdges(edges);
      onSelectionChange?.(nodes, edges);
    },
    [onSelectionChange],
  );
  const applySelectionRef = useRef(applySelection);
  applySelectionRef.current = applySelection;

  /**
   * `onHoverNode`/`onNodeMove`/`onConnect` and `a11y.announce` are read through refs inside the
   * pointer effect below rather than named in its dependency array, and deliberately so: calling
   * any of them mid-gesture (`applySelectionRef` on pointerdown, `bumpLabelTick` on every
   * pointermove) triggers a re-render of *this* component, and `useGpuA11y()` returns a brand-new
   * wrapper object every render (only the functions inside it — `announce`, individually — are
   * stable). A dependency array naming that whole object, or an inline callback prop a consumer
   * might pass, would tear the effect down and reattach it mid-drag, resetting the closured `drag`
   * variable to `null` before the next `pointermove` arrives — which reproduces, empirically, as a
   * drag or a pan that moves exactly one pixel and then appears to freeze. Refs sidestep this
   * without asking every consumer to memoize their callbacks.
   */
  const onHoverNodeRef = useRef(props.onHoverNode);
  onHoverNodeRef.current = props.onHoverNode;
  const onNodeMoveRef = useRef(props.onNodeMove);
  onNodeMoveRef.current = props.onNodeMove;
  const onConnectRef = useRef(props.onConnect);
  onConnectRef.current = props.onConnect;
  const announceRef = useRef(a11y.announce);
  announceRef.current = a11y.announce;

  /** Tracked outside `core`'s DOM-agnostic pointer model (which deliberately carries no modifier
   * keys) the same way the wheel listener below already reaches past it for a browser-only
   * concern. */
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

  const componentRef = useRef<NodeEditorComponent | null>(null);
  const factory = useCallback(() => {
    const component = new NodeEditorComponent();
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
        selectedNodes,
        selectedEdges,
      }),
      [data, viewport, props.hoveredNode, selectedNodes, selectedEdges],
    ),
  );

  useEffect(() => {
    const el = canvas;
    if (!el) return;
    const pointer = createPointerController();
    const detach = pointer.attach(el);
    let drag: DragState | null = null;

    const unsubDown = pointer.onDown((state) => {
      const port = componentRef.current?.hitTestPort(state.x, state.y) ?? null;
      if (port) {
        drag = { kind: "connect", from: port, startPx: state.x, startPy: state.y };
        return;
      }

      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      if (hit) {
        const id = Number(hit.id);
        if (shiftRef.current) {
          const next = new Set(selectedNodesRef.current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          applySelectionRef.current(next, selectedEdgesRef.current);
          drag = null;
          return;
        }
        applySelectionRef.current(new Set([id]), EMPTY_SET);
        drag = { kind: "node", id, startPx: state.x, startPy: state.y, startX: data.x[id]!, startY: data.y[id]! };
        return;
      }

      const edgeIndex = componentRef.current?.hitTestEdge(state.x, state.y) ?? null;
      if (edgeIndex != null) {
        if (shiftRef.current) {
          const next = new Set(selectedEdgesRef.current);
          if (next.has(edgeIndex)) next.delete(edgeIndex);
          else next.add(edgeIndex);
          applySelectionRef.current(selectedNodesRef.current, next);
        } else {
          applySelectionRef.current(EMPTY_SET, new Set([edgeIndex]));
        }
        drag = null;
        return;
      }

      drag = shiftRef.current
        ? { kind: "marquee", startPx: state.x, startPy: state.y }
        : { kind: "pan", startPx: state.x, startPy: state.y };
    });

    const unsubMove = pointer.onMove((state) => {
      if (drag?.kind === "pan" && state.dragging) {
        const controller = createViewportController(viewportRef.current, boundsRef.current);
        controller.panByPixels(-(state.x - drag.startPx), -(state.y - drag.startPy));
        drag = { kind: "pan", startPx: state.x, startPy: state.y };
        setViewportRef.current(controller.getState());
        onHoverNodeRef.current?.(null);
        return;
      }
      if (drag?.kind === "node" && state.dragging) {
        const v = viewportRef.current;
        const dx = pixelXToTime(v, state.x) - pixelXToTime(v, drag.startPx);
        const dy = pixelYToTrack(v, state.y) - pixelYToTrack(v, drag.startPy);
        componentRef.current?.moveNode(drag.id, drag.startX + dx, drag.startY + dy);
        onHoverNodeRef.current?.(null);
        bumpLabelTick();
        return;
      }
      if (drag?.kind === "connect" && state.dragging) {
        const v = viewportRef.current;
        const from = portPosition(data, drag.from);
        const toX = pixelXToTime(v, state.x);
        const toY = pixelYToTrack(v, state.y);
        const line =
          drag.from.kind === "out"
            ? { x0: from.x, y0: from.y, x1: toX, y1: toY }
            : { x0: toX, y0: toY, x1: from.x, y1: from.y };
        componentRef.current?.setPendingEdge(line);

        const candidate = componentRef.current?.hitTestPort(state.x, state.y) ?? null;
        const valid =
          candidate && candidate.node !== drag.from.node && candidate.kind !== drag.from.kind ? candidate : null;
        componentRef.current?.setHoveredPort(valid);
        onHoverNodeRef.current?.(null);
        return;
      }
      if (drag?.kind === "marquee" && state.dragging) {
        setMarquee({ x0: drag.startPx, y0: drag.startPy, x1: state.x, y1: state.y });
        onHoverNodeRef.current?.(null);
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHoverNodeRef.current?.(hit ? Number(hit.id) : null);
    });

    const unsubLeave = pointer.onLeave(() => onHoverNodeRef.current?.(null));

    const unsubUp = pointer.onUp((state) => {
      const finished = drag;
      drag = null;
      if (!finished) return;
      const moved = Math.hypot(state.x - finished.startPx, state.y - finished.startPy);

      if (finished.kind === "node") {
        if (moved < DRAG_THRESHOLD_PX) {
          announceRef.current(describeNode(data, finished.id));
        } else {
          onNodeMoveRef.current?.(finished.id, data.x[finished.id]!, data.y[finished.id]!);
          announceRef.current(
            `Moved ${data.labels[finished.id] ?? finished.id} to ` +
              `${data.x[finished.id]!.toFixed(2)}, ${data.y[finished.id]!.toFixed(2)}`,
          );
        }
        return;
      }

      if (finished.kind === "connect") {
        const drop = componentRef.current?.hitTestPort(state.x, state.y) ?? null;
        componentRef.current?.setPendingEdge(null);
        componentRef.current?.setHoveredPort(null);
        if (drop && drop.node !== finished.from.node && drop.kind !== finished.from.kind) {
          const outPort = finished.from.kind === "out" ? finished.from : drop;
          const inPort = finished.from.kind === "out" ? drop : finished.from;
          const ok = componentRef.current?.addEdge(outPort.node, inPort.node) ?? false;
          if (ok) {
            onConnectRef.current?.(outPort.node, inPort.node);
            announceRef.current(
              `Connected ${data.labels[outPort.node] ?? outPort.node} to ${data.labels[inPort.node] ?? inPort.node}`,
            );
          }
        }
        return;
      }

      if (finished.kind === "marquee") {
        setMarquee(null);
        const v = viewportRef.current;
        const x0 = pixelXToTime(v, Math.min(finished.startPx, state.x));
        const x1 = pixelXToTime(v, Math.max(finished.startPx, state.x));
        const y0 = pixelYToTrack(v, Math.min(finished.startPy, state.y));
        const y1 = pixelYToTrack(v, Math.max(finished.startPy, state.y));
        const found = new Set<number>();
        for (let i = 0; i < data.nodeCount; i++) {
          if (data.deleted[i]) continue;
          const nx = data.x[i]!;
          const ny = data.y[i]!;
          if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) found.add(i);
        }
        const nextNodes = shiftRef.current ? new Set([...selectedNodesRef.current, ...found]) : found;
        const nextEdges = shiftRef.current ? selectedEdgesRef.current : EMPTY_SET;
        applySelectionRef.current(nextNodes, nextEdges);
        announceRef.current(`${found.size} node${found.size === 1 ? "" : "s"} selected`);
        return;
      }

      // A plain pan that barely moved is a click on empty canvas — clear the selection.
      if (moved < DRAG_THRESHOLD_PX) applySelectionRef.current(EMPTY_SET, EMPTY_SET);
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
  }, [canvas, data]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedNodes.size === 0 && selectedEdges.size === 0) return;
      e.preventDefault();
      const component = componentRef.current;
      if (!component) return;
      // Edges first, and by descending index — `deleteEdgeAt` splices `data.edges`, so removing
      // low-to-high would shift the indices this loop hasn't visited yet.
      for (const index of [...selectedEdges].sort((a, b) => b - a)) component.deleteEdgeAt(index);
      for (const index of selectedNodes) component.deleteNode(index);
      const removedNodes = [...selectedNodes];
      const removedEdges = [...selectedEdges];
      applySelection(EMPTY_SET, EMPTY_SET);
      onDelete?.(removedNodes, removedEdges);
      a11y.announce(`Deleted ${removedNodes.length} node${removedNodes.length === 1 ? "" : "s"} and ` +
        `${removedEdges.length} connection${removedEdges.length === 1 ? "" : "s"}`);
    },
    [selectedNodes, selectedEdges, applySelection, onDelete, a11y],
  );

  const labels: PositionedLabel[] = useMemo(() => {
    const out: PositionedLabel[] = [];
    const spanX = viewport.timeEnd - viewport.timeStart;
    const boxPx = (viewport.width / Math.max(spanX, 1)) * 2 * (data.halfWidth[0] ?? 0.8);
    if (boxPx < MIN_LABEL_PX) return out;
    const rowStart = viewport.rowStart ?? 0;
    const rowEnd = viewport.rowEnd ?? viewport.trackCount;
    for (let i = 0; i < data.nodeCount && out.length < MAX_LABELS; i++) {
      if (data.deleted[i]) continue;
      const x = data.x[i]!;
      const y = data.y[i]!;
      const hw = data.halfWidth[i]!;
      const hh = data.halfHeight[i]!;
      if (x + hw < viewport.timeStart || x - hw > viewport.timeEnd) continue;
      if (y + hh < rowStart || y - hh > rowEnd) continue;
      out.push({
        key: `n${i}`,
        text: data.labels[i] ?? String(i),
        ariaLabel: describeNode(data, i),
        left: timeToPixelX(viewport, x - hw) + 6,
        top: trackToPixelY(viewport, y - hh) + 3,
      });
    }
    return out;
    // `labelTick` forces this to recompute on every node-drag pointermove, since a drag mutates
    // `data`'s typed arrays in place without changing `data`'s or `viewport`'s identity.
  }, [data, viewport, labelTick]);

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
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
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
            border: "1px solid rgba(13,15,20,0.55)",
            background: "rgba(13,15,20,0.10)",
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />
      )}
      <LabelOverlay labels={labels} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)", fontSize: 11 }} />
      {a11y.regions()}
      {props.hoveredNode != null && <div style={SR_ONLY}>{describeNode(data, props.hoveredNode)}</div>}
    </div>
  );
}
