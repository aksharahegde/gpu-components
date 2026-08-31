/**
 * Sugiyama-style layered layout + orthogonal edge routing for `GPUDepGraph`.
 *
 * Self-contained (no layout npm dependency) so the copied component stays readable and bounded.
 * Policy constants live here — consumers edit this file after `gpu-components add`.
 */

export const MAX_NODES = 4_096;
export const MAX_EDGES = 16_384;
export const MAX_LINE_SEGMENTS = 65_536;

const LAYER_GAP = 1.4;
const NODE_GAP = 1.1;
const ORDER_ITERS = 24;
const STUB = 0.35;

export interface LayoutEdge {
  readonly source: number;
  readonly target: number;
}

export interface LayoutInput {
  readonly nodeCount: number;
  readonly edges: readonly LayoutEdge[];
  readonly categories: Uint8Array;
}

export interface EdgeSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** True when this segment belongs to a feedback / back-edge. */
  readonly backEdge: boolean;
}

export interface LaidOutGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly category: Uint8Array;
  readonly flags: Uint32Array;
  readonly ranks: Int32Array;
  readonly backEdgeMask: Uint8Array;
  readonly segments: readonly EdgeSegment[];
  readonly bounds: {
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
  };
}

function buildAdj(
  nodeCount: number,
  edges: readonly LayoutEdge[],
): { out: number[][]; inn: number[][] } {
  const out: number[][] = Array.from({ length: nodeCount }, () => []);
  const inn: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const e of edges) {
    out[e.source]!.push(e.target);
    inn[e.target]!.push(e.source);
  }
  return { out, inn };
}

/** Tarjan SCCs — returns component id per node. */
function stronglyConnectedComponents(nodeCount: number, out: number[][]): number[] {
  let index = 0;
  let compId = 0;
  const indices = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  const onStack = new Uint8Array(nodeCount);
  const stack: number[] = [];
  const comp = new Int32Array(nodeCount).fill(-1);

  function strongconnect(v: number): void {
    indices[v] = index;
    low[v] = index;
    index++;
    stack.push(v);
    onStack[v] = 1;

    for (const w of out[v]!) {
      if (indices[w] === -1) {
        strongconnect(w);
        low[v] = Math.min(low[v]!, low[w]!);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v]!, indices[w]!);
      }
    }

    if (low[v] === indices[v]) {
      for (;;) {
        const w = stack.pop()!;
        onStack[w] = 0;
        comp[w] = compId;
        if (w === v) break;
      }
      compId++;
    }
  }

  for (let v = 0; v < nodeCount; v++) {
    if (indices[v] === -1) strongconnect(v);
  }
  return [...comp];
}

/**
 * Feedback arc set: within each non-trivial SCC, keep only edges that go forward in a
 * fixed member order (index in the component list). That yields an acyclic subgraph for ranking
 * while retaining every edge for drawing (marked ones become styled back-edges).
 */
function feedbackArcSet(
  nodeCount: number,
  edges: readonly LayoutEdge[],
  comp: number[],
): Uint8Array {
  const back = new Uint8Array(edges.length);
  const sccSize = new Map<number, number>();
  for (let i = 0; i < nodeCount; i++) {
    const c = comp[i]!;
    sccSize.set(c, (sccSize.get(c) ?? 0) + 1);
  }

  const orderInScc = new Int32Array(nodeCount).fill(-1);
  const next = new Map<number, number>();
  for (let i = 0; i < nodeCount; i++) {
    const c = comp[i]!;
    if ((sccSize.get(c) ?? 0) <= 1) continue;
    const o = next.get(c) ?? 0;
    orderInScc[i] = o;
    next.set(c, o + 1);
  }

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    if (comp[e.source] !== comp[e.target]) continue;
    if ((sccSize.get(comp[e.source]!) ?? 0) <= 1) continue;
    if (orderInScc[e.source]! >= orderInScc[e.target]!) {
      back[i] = 1;
    }
  }

  return back;
}

function assignRanks(
  nodeCount: number,
  edges: readonly LayoutEdge[],
  back: Uint8Array,
): Int32Array {
  const { out, inn } = buildAdj(
    nodeCount,
    edges.filter((_, i) => !back[i]),
  );
  const indeg = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) indeg[i] = inn[i]!.length;

  const ranks = new Int32Array(nodeCount).fill(0);
  const queue: number[] = [];
  for (let i = 0; i < nodeCount; i++) {
    if (indeg[i] === 0) queue.push(i);
  }
  let seen = 0;
  while (queue.length) {
    const u = queue.shift()!;
    seen++;
    for (const v of out[u]!) {
      ranks[v] = Math.max(ranks[v]!, ranks[u]! + 1);
      indeg[v]!--;
      if (indeg[v] === 0) queue.push(v);
    }
  }
  // Residual nodes in broken graphs (shouldn't happen after FAS) — park at max+1.
  if (seen < nodeCount) {
    let max = 0;
    for (let i = 0; i < nodeCount; i++) max = Math.max(max, ranks[i]!);
    for (let i = 0; i < nodeCount; i++) {
      if (indeg[i]! > 0) ranks[i] = max + 1;
    }
  }
  return ranks;
}

function orderLayers(
  nodeCount: number,
  ranks: Int32Array,
  edges: readonly LayoutEdge[],
  back: Uint8Array,
): number[][] {
  let maxRank = 0;
  for (let i = 0; i < nodeCount; i++) maxRank = Math.max(maxRank, ranks[i]!);
  const layers: number[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (let i = 0; i < nodeCount; i++) layers[ranks[i]!]!.push(i);

  const forward = edges.filter((_, i) => !back[i]);

  for (let iter = 0; iter < ORDER_ITERS; iter++) {
    // Downward barycenter
    for (let r = 1; r <= maxRank; r++) {
      const layer = layers[r]!;
      const median = new Map<number, number>();
      for (const v of layer) {
        const preds: number[] = [];
        for (const e of forward) {
          if (e.target === v && ranks[e.source] === r - 1) {
            preds.push(layers[r - 1]!.indexOf(e.source));
          }
        }
        if (preds.length === 0) {
          median.set(v, layers[r]!.indexOf(v));
        } else {
          preds.sort((a, b) => a - b);
          median.set(v, preds[Math.floor(preds.length / 2)]!);
        }
      }
      layer.sort((a, b) => (median.get(a) ?? 0) - (median.get(b) ?? 0) || a - b);
    }
    // Upward barycenter
    for (let r = maxRank - 1; r >= 0; r--) {
      const layer = layers[r]!;
      const median = new Map<number, number>();
      for (const v of layer) {
        const succs: number[] = [];
        for (const e of forward) {
          if (e.source === v && ranks[e.target] === r + 1) {
            succs.push(layers[r + 1]!.indexOf(e.target));
          }
        }
        if (succs.length === 0) {
          median.set(v, layers[r]!.indexOf(v));
        } else {
          succs.sort((a, b) => a - b);
          median.set(v, succs[Math.floor(succs.length / 2)]!);
        }
      }
      layer.sort((a, b) => (median.get(a) ?? 0) - (median.get(b) ?? 0) || a - b);
    }
  }

  return layers;
}

function placeNodes(
  layers: number[][],
): { x: Float32Array; y: Float32Array; bounds: LaidOutGraph["bounds"] } {
  const nodeCount = layers.reduce((n, L) => n + L.length, 0);
  const x = new Float32Array(nodeCount);
  const y = new Float32Array(nodeCount);
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (let r = 0; r < layers.length; r++) {
    const layer = layers[r]!;
    const width = (layer.length - 1) * NODE_GAP;
    const yPos = r * LAYER_GAP;
    for (let i = 0; i < layer.length; i++) {
      const id = layer[i]!;
      const xp = i * NODE_GAP - width / 2;
      x[id] = xp;
      y[id] = yPos;
      xMin = Math.min(xMin, xp);
      xMax = Math.max(xMax, xp);
      yMin = Math.min(yMin, yPos);
      yMax = Math.max(yMax, yPos);
    }
  }

  if (!(xMin < xMax)) {
    xMin = -1;
    xMax = 1;
  }
  if (!(yMin < yMax)) {
    yMin = -1;
    yMax = 1;
  }
  // Pad so nodes aren't flush with the viewport edge.
  const padX = Math.max(0.75, (xMax - xMin) * 0.08);
  const padY = Math.max(0.75, (yMax - yMin) * 0.08);
  return {
    x,
    y,
    bounds: {
      xMin: xMin - padX,
      xMax: xMax + padX,
      yMin: yMin - padY,
      yMax: yMax + padY,
    },
  };
}

function pushSeg(
  segments: EdgeSegment[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  backEdge: boolean,
): void {
  if (segments.length >= MAX_LINE_SEGMENTS) return;
  if (x0 === x1 && y0 === y1) return;
  segments.push({ x0, y0, x1, y1, backEdge });
}

/** Orthogonal route: stub down from source, horizontal, stub into target. */
function routeOrthogonal(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  backEdge: boolean,
  segments: EdgeSegment[],
): void {
  if (backEdge) {
    // Detour to the right and below both endpoints.
    const midX = Math.max(sx, tx) + 1.2;
    const midY = Math.max(sy, ty) + 0.9;
    pushSeg(segments, sx, sy, sx, sy + STUB, true);
    pushSeg(segments, sx, sy + STUB, midX, sy + STUB, true);
    pushSeg(segments, midX, sy + STUB, midX, midY, true);
    pushSeg(segments, midX, midY, tx, midY, true);
    pushSeg(segments, tx, midY, tx, ty, true);
    return;
  }

  const yMid = (sy + ty) / 2;
  pushSeg(segments, sx, sy, sx, yMid, false);
  pushSeg(segments, sx, yMid, tx, yMid, false);
  pushSeg(segments, tx, yMid, tx, ty, false);
}

export function layoutDepGraph(input: LayoutInput): LaidOutGraph {
  const { nodeCount, edges, categories } = input;
  const { out } = buildAdj(nodeCount, edges);
  const comp = stronglyConnectedComponents(nodeCount, out);
  const back = feedbackArcSet(nodeCount, edges, comp);
  const ranks = assignRanks(nodeCount, edges, back);
  const layers = orderLayers(nodeCount, ranks, edges, back);
  const { x, y, bounds } = placeNodes(layers);

  const flags = new Uint32Array(nodeCount);
  const indegForward = new Int32Array(nodeCount);
  for (let i = 0; i < edges.length; i++) {
    if (back[i]) continue;
    indegForward[edges[i]!.target]!++;
  }
  for (let i = 0; i < nodeCount; i++) {
    if (indegForward[i] === 0) flags[i]! |= 1; // NODE_FLAG_ROOT
  }
  for (let i = 0; i < edges.length; i++) {
    if (!back[i]) continue;
    flags[edges[i]!.source]! |= 2;
    flags[edges[i]!.target]! |= 2;
  }

  const segments: EdgeSegment[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    routeOrthogonal(x[e.source]!, y[e.source]!, x[e.target]!, y[e.target]!, back[i] === 1, segments);
  }

  return {
    nodeCount,
    edgeCount: edges.length,
    x,
    y,
    category: categories,
    flags,
    ranks,
    backEdgeMask: back,
    segments,
    bounds,
  };
}
