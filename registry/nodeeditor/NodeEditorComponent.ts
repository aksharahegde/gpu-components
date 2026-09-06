import {
  assertBufferBudget,
  InstancedQuadLayer,
  LineLayer,
  packRgba8,
  pixelXToTime,
  pixelYToTrack,
  viewportUniforms,
} from "@gpu-components/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  LineInstance,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpu-components/core";
import { uniforms } from "vgpu";
import type { SharedUniforms } from "vgpu";
import {
  addEdge as addEdgeToData,
  distToSegmentSquared,
  markNodeDeleted,
  NODE_STRIDE,
  packNodes,
  packPorts,
  PORT_STRIDE,
  removeEdgeAt,
  type NodeEditorData,
  type PortRef,
} from "./ingest.ts";
import { NODEEDITOR_WGSL } from "./nodeeditor.wgsl.ts";
import { PORTS_WGSL } from "./ports.wgsl.ts";

export interface NodeEditorProps {
  readonly data: NodeEditorData;
  readonly viewport: ViewportState;
  readonly hoveredNode?: number | null;
  readonly selectedNodes?: ReadonlySet<number>;
  readonly selectedEdges?: ReadonlySet<number>;
  readonly opacity?: number;
}

interface NodeUniforms extends Record<string, unknown> {
  readonly hoveredNode: number;
  readonly opacity: number;
  readonly _pad0: number;
  readonly _pad1: number;
}

const EDGE_WIDTH_PX = 1.5;
const EDGE_COLOR = packRgba8(90, 102, 124, 170);
const EDGE_SELECTED_COLOR = packRgba8(13, 15, 20, 230);
const PENDING_EDGE_COLOR = packRgba8(13, 15, 20, 150);

/** Screen-pixel hit radius for a port — bigger than its ~5px drawn radius, matching the standard
 * "grab target should be bigger than the visible glyph" affordance. */
const PORT_HIT_RADIUS_PX = 12;
/** Screen-pixel hit distance for an edge line. */
const EDGE_HIT_RADIUS_PX = 6;

let nextId = 0;

/**
 * `GPUNodeEditor` — freeform node-flow canvas (PLAN.md #13).
 *
 * Node positions are a CPU source of truth the *caller* owns (see `ingest.ts`'s header note) —
 * this component only draws them and hit-tests against them, exactly the DepGraph/Scatter shape
 * PLAN.md §9.5 favours over GPU picking, and for the same reason: positions here change only on an
 * explicit user action, never every frame on their own, so there is no "rebuild every frame" cost
 * that would justify GPU picking instead.
 *
 * `moveNode`/`addEdge`/`deleteEdgeAt`/`deleteNode` are all the same shape: mutate the CPU data in
 * place, re-upload, mark dirty. None of them go through React's `update()`/props diff — they are
 * the imperative escape hatch a drag or a keyboard delete calls directly (`GPUNodeEditor.tsx`'s
 * doc comment explains why).
 */
export class NodeEditorComponent implements GpuComponent<NodeEditorProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private caps: ComponentContext["caps"] | null = null;
  private nodeLayer: InstancedQuadLayer | null = null;
  private edgeLayer: LineLayer | null = null;
  private portLayer: InstancedQuadLayer | null = null;
  private pendingEdgeLayer: LineLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private nodeParams: SharedUniforms<NodeUniforms> | null = null;

  private uploadedData: NodeEditorData | null = null;
  private currentViewport: ViewportState | null = null;
  private currentSelectedNodes: ReadonlySet<number> | undefined;
  private currentSelectedEdges: ReadonlySet<number> | undefined;
  private currentHoveredPort: PortRef | null = null;

  constructor() {
    this.id = `nodeeditor-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.caps = ctx.caps;

    this.nodeLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: NODEEDITOR_WGSL,
      instanceStride: NODE_STRIDE,
      capacity: Math.max(1, this.uploadedData?.nodeCount ?? 64),
      label: `${this.id}-nodes`,
      warnings: ctx.runtime.warnings,
    });
    this.edgeLayer = new LineLayer({
      gpu: ctx.gpu,
      capacity: Math.max(1, this.uploadedData?.edgeCount ?? 64),
      label: `${this.id}-edges`,
      warnings: ctx.runtime.warnings,
    });
    this.portLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: PORTS_WGSL,
      instanceStride: PORT_STRIDE,
      capacity: Math.max(2, (this.uploadedData?.nodeCount ?? 32) * 2),
      label: `${this.id}-ports`,
      warnings: ctx.runtime.warnings,
    });
    this.pendingEdgeLayer = new LineLayer({
      gpu: ctx.gpu,
      capacity: 1,
      label: `${this.id}-pending-edge`,
      warnings: ctx.runtime.warnings,
    });

    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.nodeParams = uniforms(ctx.gpu, {
      hoveredNode: -1,
      opacity: 1,
      _pad0: 0,
      _pad1: 0,
    });

    this.nodeLayer.bindViewport(this.viewportUniform);
    this.edgeLayer.bindViewport(this.viewportUniform);
    this.portLayer.bindViewport(this.viewportUniform);
    this.pendingEdgeLayer.bindViewport(this.viewportUniform);
    this.nodeLayer.bind({ params: this.nodeParams });

    if (this.uploadedData) this.uploadData(this.uploadedData);
    if (this.currentViewport) this.writeViewport(this.currentViewport);
  }

  private uploadData(data: NodeEditorData): void {
    if (this.caps) {
      assertBufferBudget(this.caps, data.nodeCount * NODE_STRIDE, "GPUNodeEditor nodes", NODE_STRIDE);
    }
    this.nodeLayer?.upload(packNodes(data, this.currentSelectedNodes), data.nodeCount);
    this.portLayer?.upload(packPorts(data, this.currentHoveredPort), data.nodeCount * 2);

    const selectedEdges = this.currentSelectedEdges;
    const lines: LineInstance[] = [];
    let edgeIndex = 0;
    for (const e of data.edges) {
      if (!data.deleted[e.source] && !data.deleted[e.target]) {
        const selected = selectedEdges?.has(edgeIndex) ?? false;
        lines.push({
          x0: data.x[e.source]! + data.halfWidth[e.source]!,
          y0: data.y[e.source]!,
          x1: data.x[e.target]! - data.halfWidth[e.target]!,
          y1: data.y[e.target]!,
          widthPx: selected ? EDGE_WIDTH_PX * 1.4 : EDGE_WIDTH_PX,
          color: selected ? EDGE_SELECTED_COLOR : EDGE_COLOR,
        });
      }
      edgeIndex++;
    }
    this.edgeLayer?.uploadLines(lines);
  }

  private writeViewport(viewport: ViewportState): void {
    this.viewportUniform?.set(viewportUniforms(viewport));
  }

  update(props: NodeEditorProps): void {
    const dataChanged = props.data !== this.uploadedData;
    const selectionChanged =
      props.selectedNodes !== this.currentSelectedNodes || props.selectedEdges !== this.currentSelectedEdges;
    this.uploadedData = props.data;
    this.currentSelectedNodes = props.selectedNodes;
    this.currentSelectedEdges = props.selectedEdges;
    if (dataChanged || selectionChanged) {
      this.uploadData(props.data);
    }
    this.currentViewport = props.viewport;
    this.writeViewport(props.viewport);
    this.nodeParams?.set({
      hoveredNode: props.hoveredNode ?? -1,
      opacity: props.opacity ?? 1,
      _pad0: 0,
      _pad1: 0,
    });
    this.dirty = true;
  }

  /** Box hit-test in domain space — a node editor's boxes have real extent, unlike DepGraph's
   * fixed-radius discs, so this is an axis-aligned rect test rather than nearest-neighbour. Later
   * instances win ties, matching paint order (the last-drawn box is the topmost one on screen).
   * Skips soft-deleted nodes. */
  hitTest(px: number, py: number): HitResult | null {
    const viewport = this.currentViewport;
    const data = this.uploadedData;
    if (!viewport || !data) return null;

    const dataX = pixelXToTime(viewport, px);
    const dataY = pixelYToTrack(viewport, py);

    let best = -1;
    for (let i = 0; i < data.nodeCount; i++) {
      if (data.deleted[i]) continue;
      const hx = data.halfWidth[i]!;
      const hy = data.halfHeight[i]!;
      if (Math.abs(data.x[i]! - dataX) <= hx && Math.abs(data.y[i]! - dataY) <= hy) {
        best = i;
      }
    }
    return best < 0 ? null : { id: best };
  }

  /** Nearest port (input or output) within `PORT_HIT_RADIUS_PX`, or `null`. Ports sit exactly at
   * `deriveEdgeLines()`'s endpoints, so a completed drag lines up with the edge it draws. */
  hitTestPort(px: number, py: number): PortRef | null {
    const viewport = this.currentViewport;
    const data = this.uploadedData;
    if (!viewport || !data) return null;

    const dataX = pixelXToTime(viewport, px);
    const dataY = pixelYToTrack(viewport, py);
    const unitsPerPxX = (viewport.timeEnd - viewport.timeStart) / Math.max(viewport.width, 1);
    const rowStart = viewport.rowStart ?? 0;
    const rowEnd = viewport.rowEnd ?? viewport.trackCount;
    const unitsPerPxY = (rowEnd - rowStart) / Math.max(viewport.height, 1);
    const radius = PORT_HIT_RADIUS_PX * Math.max(unitsPerPxX, unitsPerPxY);
    const r2 = radius * radius;

    let best: PortRef | null = null;
    let bestD = r2;
    for (let i = 0; i < data.nodeCount; i++) {
      if (data.deleted[i]) continue;
      const y = data.y[i]!;
      const inX = data.x[i]! - data.halfWidth[i]!;
      const dIn = (inX - dataX) ** 2 + (y - dataY) ** 2;
      if (dIn <= bestD) {
        bestD = dIn;
        best = { node: i, kind: "in" };
      }
      const outX = data.x[i]! + data.halfWidth[i]!;
      const dOut = (outX - dataX) ** 2 + (y - dataY) ** 2;
      if (dOut <= bestD) {
        bestD = dOut;
        best = { node: i, kind: "out" };
      }
    }
    return best;
  }

  /** Nearest edge within `EDGE_HIT_RADIUS_PX` of the point-to-segment distance, or `null`. Returns
   * an index into `data.edges` — the same index `deleteEdgeAt()`/`selectedEdges` address. */
  hitTestEdge(px: number, py: number): number | null {
    const viewport = this.currentViewport;
    const data = this.uploadedData;
    if (!viewport || !data) return null;

    const dataX = pixelXToTime(viewport, px);
    const dataY = pixelYToTrack(viewport, py);
    const unitsPerPxX = (viewport.timeEnd - viewport.timeStart) / Math.max(viewport.width, 1);
    const threshold = EDGE_HIT_RADIUS_PX * unitsPerPxX;
    const t2 = threshold * threshold;

    let best = -1;
    let bestD = t2;
    for (let i = 0; i < data.edges.length; i++) {
      const e = data.edges[i]!;
      if (data.deleted[e.source] || data.deleted[e.target]) continue;
      const x0 = data.x[e.source]! + data.halfWidth[e.source]!;
      const y0 = data.y[e.source]!;
      const x1 = data.x[e.target]! - data.halfWidth[e.target]!;
      const y1 = data.y[e.target]!;
      const d = distToSegmentSquared(dataX, dataY, x0, y0, x1, y1);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best < 0 ? null : best;
  }

  /**
   * Writes a new position directly into the CPU source-of-truth arrays and re-uploads — the
   * imperative escape hatch a drag interaction calls every `pointermove`, bypassing React's
   * `update()`/props diff entirely (the same "push to a ref, don't re-render" discipline
   * `GPUGraph`'s `onProgress` and `GPUScatter`'s `setSelection()` use for anything that needs to
   * happen every frame of an interaction).
   *
   * Re-uploads the *entire* node/edge/port buffers rather than patching one instance — simplest
   * correct thing, and cheap at node-editor scale (thousands, not millions, of nodes/edges); this
   * is the first place to optimise if a profile ever says otherwise, same as the polyline-vs-bezier
   * edge-routing choice in `ingest.ts`.
   *
   * Does not touch `data.bounds` — a node dragged outside the graph's original extent still draws
   * and hit-tests correctly, but the viewport's pan/zoom clamp (computed once from `bounds` at
   * mount) does not grow to follow it. Known limitation; revisit if it matters in practice.
   */
  moveNode(index: number, x: number, y: number): void {
    const data = this.uploadedData;
    if (!data || index < 0 || index >= data.nodeCount || data.deleted[index]) return;
    data.x[index] = x;
    data.y[index] = y;
    this.uploadData(data);
    this.dirty = true;
  }

  /** Adds an edge from a completed drag-to-connect gesture. Returns whether it was accepted
   * (`ingest.ts`'s `addEdge` rejects self-loops, out-of-range, or deleted endpoints). */
  addEdge(source: number, target: number): boolean {
    const data = this.uploadedData;
    if (!data) return false;
    const ok = addEdgeToData(data, source, target);
    if (ok) {
      this.uploadData(data);
      this.dirty = true;
    }
    return ok;
  }

  /** Removes one edge by its index into `data.edges`. */
  deleteEdgeAt(index: number): void {
    const data = this.uploadedData;
    if (!data) return;
    removeEdgeAt(data, index);
    this.uploadData(data);
    this.dirty = true;
  }

  /** Soft-deletes a node and every edge touching it (see `ingest.ts`'s `markNodeDeleted`). */
  deleteNode(index: number): void {
    const data = this.uploadedData;
    if (!data) return;
    markNodeDeleted(data, index);
    this.uploadData(data);
    this.dirty = true;
  }

  /** Renders (and re-renders) the live preview line for an in-progress drag-to-connect gesture.
   * `null` clears it. Does not touch the node/edge buffers — a drag redraws only this one line. */
  setPendingEdge(line: { x0: number; y0: number; x1: number; y1: number } | null): void {
    if (!this.pendingEdgeLayer) return;
    if (!line) {
      this.pendingEdgeLayer.uploadLines([]);
    } else {
      this.pendingEdgeLayer.uploadLines([
        { ...line, widthPx: EDGE_WIDTH_PX * 1.3, color: PENDING_EDGE_COLOR },
      ]);
    }
    this.dirty = true;
  }

  /** Highlights `port` as the current drag's candidate drop target (or clears it with `null`). */
  setHoveredPort(port: PortRef | null): void {
    this.currentHoveredPort = port;
    const data = this.uploadedData;
    if (data) {
      this.portLayer?.upload(packPorts(data, port), data.nodeCount * 2);
      this.dirty = true;
    }
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedData || !this.currentViewport) {
      return { computePasses: [], renderPasses: [] };
    }
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "nodeeditor",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.edgeLayer?.draw(pass);
            this.pendingEdgeLayer?.draw(pass);
            this.nodeLayer?.draw(pass);
            this.portLayer?.draw(pass);
          },
        },
      ],
    };
  }

  dispose(): void {
    this.nodeLayer?.dispose();
    this.edgeLayer?.dispose();
    this.portLayer?.dispose();
    this.pendingEdgeLayer?.dispose();
  }
}
