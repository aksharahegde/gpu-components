/**
 * `GPUGraph`'s data model — PLAN.md §6.2's `GPUGraph (force layout)` candidate.
 *
 * §8.1 ranked this the *weakest* of the three original candidates and it was right to, for the
 * question it was answering: "cosmos.gl already does GPU force layout at ~1M nodes in WebGL, well.
 * A WebGPU rewrite of a solved problem is the lowest-differentiation option." That was about which
 * component should prove the runtime to the market first. With four components shipped, the
 * question is which one stresses the parts of `core` nothing has touched — and on that question the
 * graph is the *only* candidate that animates continuously, needs iterative ping-pong compute, and
 * has positions that move every frame.
 *
 * Adjacency is stored CSR-style so the layout kernel can walk one node's neighbours without atomics
 * and without a second pass — the same shape `registry/scatter/spatialIndex.ts` uses, for the same
 * reason: one contiguous array beats a per-node list of lists on both memory and access pattern.
 */

/** Bytes per node position on the GPU: vec2<f32>. */
export const POSITION_STRIDE = 8;
/** Bytes per edge: two u32 endpoints. */
export const EDGE_STRIDE = 8;

export interface GraphData {
  readonly nodeCount: number;
  /** Initial positions, interleaved x,y. The layout mutates GPU-side copies, never these. */
  readonly positions: Float32Array<ArrayBuffer>;
  readonly category: Uint8Array;
  /** Interleaved source,target node indices. */
  readonly edges: Uint32Array<ArrayBuffer>;
  readonly edgeCount: number;
  /** CSR neighbour offsets, `nodeCount + 1` entries. */
  readonly adjacencyStarts: Uint32Array<ArrayBuffer>;
  /** CSR neighbour indices, `2 * edgeCount` entries (each edge appears from both ends). */
  readonly adjacencyItems: Uint32Array<ArrayBuffer>;
  readonly labels?: readonly string[];
}

export interface RawEdge {
  readonly source: number;
  readonly target: number;
}

/** Deterministic PRNG, so a seeded layout is reproducible — which is what makes the pixel tests
 * viable at all. §8.1 flagged force layout's "poor determinism (bad for snapshot testing)" as a
 * risk; seeding the initial placement and fixing the iteration count is the answer. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a graph, validating edges and seeding an initial circular-ish layout.
 *
 * Edge validation is the §24.2 rule applied to a different shape of hostile input: an out-of-range
 * endpoint would index past the position buffer in the layout kernel. WGSL bounds-checks storage
 * reads so it could not corrupt memory, but it would silently pull garbage coordinates into the
 * simulation and blow the layout apart. Invalid edges are dropped and counted, never silently kept.
 */
export function ingestGraph(
  nodeCount: number,
  rawEdges: readonly RawEdge[],
  options: { readonly seed?: number; readonly category?: Uint8Array; readonly labels?: readonly string[] } = {},
): { readonly graph: GraphData; readonly droppedEdges: number } {
  if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
    throw new RangeError(`gpu-components/graph: nodeCount must be a positive integer, got ${nodeCount}`);
  }

  const rnd = mulberry32(options.seed ?? 0x9e3779b9);
  const positions = new Float32Array(new ArrayBuffer(nodeCount * 2 * 4));
  for (let i = 0; i < nodeCount; i++) {
    // Seeded on a jittered ring: a pure circle makes the first iterations degenerate (every
    // repulsion vector points at the centre), and pure noise takes far longer to untangle.
    const angle = (i / nodeCount) * Math.PI * 2;
    const radius = 0.35 + rnd() * 0.15;
    positions[i * 2] = Math.cos(angle) * radius + (rnd() - 0.5) * 0.05;
    positions[i * 2 + 1] = Math.sin(angle) * radius + (rnd() - 0.5) * 0.05;
  }

  const kept: RawEdge[] = [];
  let droppedEdges = 0;
  for (const edge of rawEdges) {
    const valid =
      Number.isInteger(edge.source) &&
      Number.isInteger(edge.target) &&
      edge.source >= 0 &&
      edge.target >= 0 &&
      edge.source < nodeCount &&
      edge.target < nodeCount &&
      edge.source !== edge.target;
    if (valid) kept.push(edge);
    else droppedEdges++;
  }

  const edges = new Uint32Array(new ArrayBuffer(kept.length * 2 * 4));
  const degree = new Uint32Array(nodeCount);
  kept.forEach((edge, i) => {
    edges[i * 2] = edge.source;
    edges[i * 2 + 1] = edge.target;
    degree[edge.source]!++;
    degree[edge.target]!++;
  });

  const adjacencyStarts = new Uint32Array(new ArrayBuffer((nodeCount + 1) * 4));
  for (let i = 0; i < nodeCount; i++) adjacencyStarts[i + 1] = adjacencyStarts[i]! + degree[i]!;

  const adjacencyItems = new Uint32Array(new ArrayBuffer(kept.length * 2 * 4));
  const cursor = new Uint32Array(nodeCount);
  for (const edge of kept) {
    adjacencyItems[adjacencyStarts[edge.source]! + cursor[edge.source]!] = edge.target;
    cursor[edge.source]!++;
    adjacencyItems[adjacencyStarts[edge.target]! + cursor[edge.target]!] = edge.source;
    cursor[edge.target]!++;
  }

  return {
    graph: {
      nodeCount,
      positions,
      category: options.category ?? new Uint8Array(nodeCount),
      edges,
      edgeCount: kept.length,
      adjacencyStarts,
      adjacencyItems,
      labels: options.labels,
    },
    droppedEdges,
  };
}

/** Convenience generator for demos and tests: `clusters` groups, densely linked inside, sparsely
 * between. Deterministic for a given seed. */
export function generateClusteredGraph(
  nodesPerCluster: number,
  clusters: number,
  seed = 0x5eed,
): { readonly graph: GraphData; readonly droppedEdges: number } {
  const rnd = mulberry32(seed);
  const nodeCount = nodesPerCluster * clusters;
  const category = new Uint8Array(nodeCount);
  const edges: RawEdge[] = [];

  for (let c = 0; c < clusters; c++) {
    const base = c * nodesPerCluster;
    for (let i = 0; i < nodesPerCluster; i++) {
      category[base + i] = c;
      // Two intra-cluster edges per node keeps each cluster connected without exploding edge count.
      for (let k = 0; k < 2; k++) {
        const target = base + Math.floor(rnd() * nodesPerCluster);
        if (target !== base + i) edges.push({ source: base + i, target });
      }
    }
    // A few bridges to the next cluster, so the layout has something to pull apart.
    for (let b = 0; b < 3; b++) {
      const other = ((c + 1) % clusters) * nodesPerCluster;
      edges.push({
        source: base + Math.floor(rnd() * nodesPerCluster),
        target: other + Math.floor(rnd() * nodesPerCluster),
      });
    }
  }

  return ingestGraph(nodeCount, edges, { seed, category });
}
