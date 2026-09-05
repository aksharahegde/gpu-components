/**
 * `GPUNodeEditor` data model (PLAN.md #13, "GPU node / flow editor").
 *
 * Unlike `GPUDepGraph`, positions are not computed by a layout pass — a node editor's whole point
 * is that the *user* places nodes, so `x`/`y` come from the caller (a saved graph, or the last
 * drag). Nodes omitting a position get a simple grid fallback, purely so a fresh, empty-of-layout
 * graph still renders something sane on first mount.
 *
 * Box sizes are domain-space (half-width/half-height in the same units as `x`/`y`), not CSS
 * pixels like `GPUDepGraph`'s `nodeSizePx` — a node editor's boxes are expected to scale under
 * zoom the way the canvas itself does (Figma/Blender-style), not stay a fixed screen size.
 *
 * Deletion is **soft**: `deleted[i]` flags a node rather than removing it from the typed arrays.
 * A node editor's indices are its identity — everything from `GPUNodeEditor`'s own selection state
 * to a consumer's saved layout addresses nodes by index — so compacting the arrays on delete would
 * silently renumber every node after the one removed. `packNodes()`/`hitTest()`/edge derivation all
 * skip deleted nodes; nothing else needs to know they still occupy a slot.
 */

export const MAX_NODES = 4_096;
export const MAX_EDGES = 16_384;

/** Bytes per node instance: x, y, halfWidth, halfHeight (f32) + category, flags (u32) + 2×pad. */
export const NODE_STRIDE = 32;
/** Bytes per port instance: x, y (f32) + kind, flags (u32). */
export const PORT_STRIDE = 16;

export const NODE_FLAG_NONE = 0;
export const NODE_FLAG_DELETED = 1;
export const NODE_FLAG_SELECTED = 2;

export const PORT_FLAG_OWNER_DELETED = 1;
export const PORT_FLAG_HOVERED = 2;

const DEFAULT_HALF_WIDTH = 0.8;
const DEFAULT_HALF_HEIGHT = 0.45;
const GRID_GAP_X = 2.4;
const GRID_GAP_Y = 1.4;

export interface RawNodeEditorNode {
  readonly id?: string;
  readonly label?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly category?: number;
}

export interface RawNodeEditorEdge {
  readonly source: number;
  readonly target: number;
}

export interface NodeEditorInput {
  readonly nodes: readonly RawNodeEditorNode[];
  readonly edges: readonly RawNodeEditorEdge[];
}

export interface NodeEditorEdge {
  readonly source: number;
  readonly target: number;
}

export interface PortRef {
  readonly node: number;
  readonly kind: "in" | "out";
}

export interface NodeEditorData {
  readonly nodeCount: number;
  /** Mutated by `addEdge`/`removeEdgeAt`/`markNodeDeleted` — kept in lockstep with `edges.length`. */
  edgeCount: number;
  /** Mutable on purpose: dragging a node writes these arrays in place rather than re-ingesting the
   * whole graph (see `NodeEditorComponent.moveNode()`). */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly halfWidth: Float32Array;
  readonly halfHeight: Float32Array;
  readonly category: Uint8Array;
  /** 0/1 per node — see the module doc comment on why deletion is soft. */
  readonly deleted: Uint8Array;
  readonly labels: readonly string[];
  /** Mutable: `addEdge()`/`removeEdgeAt()` push/splice this array directly. */
  edges: NodeEditorEdge[];
  readonly inDegree: Uint16Array;
  readonly outDegree: Uint16Array;
  readonly bounds: {
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
  };
}

function defaultPosition(index: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(index + 1)));
  return { x: (index % cols) * GRID_GAP_X, y: Math.floor(index / cols) * GRID_GAP_Y };
}

/** Validates endpoints, caps size, and returns GPU-ready columnar buffers. */
export function ingestNodeEditor(input: NodeEditorInput): NodeEditorData {
  const nodeCount = input.nodes.length;
  if (nodeCount === 0) {
    throw new RangeError("gpu-components/nodeeditor: at least one node is required");
  }
  if (nodeCount > MAX_NODES) {
    throw new RangeError(`gpu-components/nodeeditor: at most ${MAX_NODES} nodes, got ${nodeCount}`);
  }
  if (input.edges.length > MAX_EDGES) {
    throw new RangeError(`gpu-components/nodeeditor: at most ${MAX_EDGES} edges, got ${input.edges.length}`);
  }

  const x = new Float32Array(nodeCount);
  const y = new Float32Array(nodeCount);
  const halfWidth = new Float32Array(nodeCount);
  const halfHeight = new Float32Array(nodeCount);
  const category = new Uint8Array(nodeCount);
  const deleted = new Uint8Array(nodeCount);
  const labels: string[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const n = input.nodes[i]!;
    const fallback = n.x == null || n.y == null ? defaultPosition(i) : null;
    x[i] = n.x ?? fallback!.x;
    y[i] = n.y ?? fallback!.y;
    halfWidth[i] = Math.max(0.05, (n.width ?? DEFAULT_HALF_WIDTH * 2) / 2);
    halfHeight[i] = Math.max(0.05, (n.height ?? DEFAULT_HALF_HEIGHT * 2) / 2);
    category[i] = (n.category ?? 0) & 255;
    labels.push(n.label ?? n.id ?? `node ${i}`);
  }

  const inDegree = new Uint16Array(nodeCount);
  const outDegree = new Uint16Array(nodeCount);
  const edges: NodeEditorEdge[] = [];
  for (let i = 0; i < input.edges.length; i++) {
    const e = input.edges[i]!;
    if (
      !Number.isInteger(e.source) ||
      !Number.isInteger(e.target) ||
      e.source < 0 ||
      e.target < 0 ||
      e.source >= nodeCount ||
      e.target >= nodeCount
    ) {
      throw new RangeError(`gpu-components/nodeeditor: edge ${i} endpoints out of range (${e.source}->${e.target})`);
    }
    edges.push({ source: e.source, target: e.target });
    outDegree[e.source]!++;
    inDegree[e.target]!++;
  }

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < nodeCount; i++) {
    xMin = Math.min(xMin, x[i]! - halfWidth[i]!);
    xMax = Math.max(xMax, x[i]! + halfWidth[i]!);
    yMin = Math.min(yMin, y[i]! - halfHeight[i]!);
    yMax = Math.max(yMax, y[i]! + halfHeight[i]!);
  }
  const padX = Math.max(0.5, (xMax - xMin) * 0.1);
  const padY = Math.max(0.5, (yMax - yMin) * 0.1);

  return {
    nodeCount,
    edgeCount: edges.length,
    x,
    y,
    halfWidth,
    halfHeight,
    category,
    deleted,
    labels,
    edges,
    inDegree,
    outDegree,
    bounds: { xMin: xMin - padX, xMax: xMax + padX, yMin: yMin - padY, yMax: yMax + padY },
  };
}

/**
 * Adds one edge to the live graph, from a completed drag-to-connect gesture. Rejects a self-loop,
 * an out-of-range endpoint, or either endpoint being deleted — the same validation `ingestNodeEditor`
 * applies to endpoints supplied up front. Returns whether the edge was added.
 */
export function addEdge(data: NodeEditorData, source: number, target: number): boolean {
  if (source === target) return false;
  if (source < 0 || source >= data.nodeCount || target < 0 || target >= data.nodeCount) return false;
  if (data.deleted[source] || data.deleted[target]) return false;
  data.edges.push({ source, target });
  data.edgeCount = data.edges.length;
  data.outDegree[source]!++;
  data.inDegree[target]!++;
  return true;
}

/** Removes the edge at `index`, keeping `inDegree`/`outDegree`/`edgeCount` consistent. */
export function removeEdgeAt(data: NodeEditorData, index: number): void {
  const e = data.edges[index];
  if (!e) return;
  data.edges.splice(index, 1);
  data.edgeCount = data.edges.length;
  data.outDegree[e.source]!--;
  data.inDegree[e.target]!--;
}

/**
 * Soft-deletes a node (see the module doc comment) and removes every edge touching it — a deleted
 * node's dangling edges would otherwise still draw a stub line to nowhere. Removes from the end of
 * `edges` so each `removeEdgeAt` splice can't shift an index this loop hasn't visited yet.
 */
export function markNodeDeleted(data: NodeEditorData, index: number): void {
  if (index < 0 || index >= data.nodeCount || data.deleted[index]) return;
  data.deleted[index] = 1;
  for (let i = data.edges.length - 1; i >= 0; i--) {
    const e = data.edges[i]!;
    if (e.source === index || e.target === index) removeEdgeAt(data, i);
  }
}

/** Packs node instances for `InstancedQuadLayer`. `selected` bakes `NODE_FLAG_SELECTED` directly
 * into the instance data rather than a uniform compare, so multi-select highlighting scales to an
 * arbitrary set without a second GPU resource. */
export function packNodes(data: NodeEditorData, selected?: ReadonlySet<number>): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(data.nodeCount * NODE_STRIDE));
  const view = new DataView(out.buffer);
  for (let i = 0; i < data.nodeCount; i++) {
    const at = i * NODE_STRIDE;
    let flags = NODE_FLAG_NONE;
    if (data.deleted[i]) flags |= NODE_FLAG_DELETED;
    if (selected?.has(i)) flags |= NODE_FLAG_SELECTED;
    view.setFloat32(at + 0, data.x[i]!, true);
    view.setFloat32(at + 4, data.y[i]!, true);
    view.setFloat32(at + 8, data.halfWidth[i]!, true);
    view.setFloat32(at + 12, data.halfHeight[i]!, true);
    view.setUint32(at + 16, data.category[i]!, true);
    view.setUint32(at + 20, flags, true);
    view.setUint32(at + 24, 0, true);
    view.setUint32(at + 28, 0, true);
  }
  return out;
}

/** Packs two port instances per node (input then output) for `InstancedQuadLayer`. `hovered`
 * highlights the one port that is the current drag's candidate drop target, if any. */
export function packPorts(data: NodeEditorData, hovered?: PortRef | null): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(data.nodeCount * 2 * PORT_STRIDE));
  const view = new DataView(out.buffer);
  for (let i = 0; i < data.nodeCount; i++) {
    for (const kind of [0, 1] as const) {
      const at = (i * 2 + kind) * PORT_STRIDE;
      const x = kind === 0 ? data.x[i]! - data.halfWidth[i]! : data.x[i]! + data.halfWidth[i]!;
      let flags = 0;
      if (data.deleted[i]) flags |= PORT_FLAG_OWNER_DELETED;
      if (hovered && hovered.node === i && hovered.kind === (kind === 0 ? "in" : "out")) {
        flags |= PORT_FLAG_HOVERED;
      }
      view.setFloat32(at + 0, x, true);
      view.setFloat32(at + 4, data.y[i]!, true);
      view.setUint32(at + 8, kind, true);
      view.setUint32(at + 12, flags, true);
    }
  }
  return out;
}

/** The domain-space point a port sits at — the exact endpoint `deriveEdgeLines()` uses, so a
 * connect-drag's live preview line lines up with the committed edge it becomes. */
export function portPosition(data: NodeEditorData, port: PortRef): { readonly x: number; readonly y: number } {
  const x = port.kind === "in" ? data.x[port.node]! - data.halfWidth[port.node]! : data.x[port.node]! + data.halfWidth[port.node]!;
  return { x, y: data.y[port.node]! };
}

export interface EdgeLine {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * One straight line per edge, from the source node's right edge to the target node's left edge —
 * the standard left-to-right flow-editor convention. Recomputed from the live `x`/`y` arrays
 * rather than baked at ingest, so dragging a node needs no new wiring, only a call into this same
 * function. Skips edges touching a deleted node.
 */
export function deriveEdgeLines(data: NodeEditorData): EdgeLine[] {
  const lines: EdgeLine[] = [];
  for (const e of data.edges) {
    if (data.deleted[e.source] || data.deleted[e.target]) continue;
    lines.push({
      x0: data.x[e.source]! + data.halfWidth[e.source]!,
      y0: data.y[e.source]!,
      x1: data.x[e.target]! - data.halfWidth[e.target]!,
      y1: data.y[e.target]!,
    });
  }
  return lines;
}

/** Squared distance from `(px, py)` to the segment `(x0,y0)-(x1,y1)` — edge hit-testing's inner loop. */
export function distToSegmentSquared(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}
