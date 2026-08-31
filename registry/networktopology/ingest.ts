export const KIND = { region: 0, az: 1, service: 2, pod: 3, host: 4 } as const;
export type NodeKind = keyof typeof KIND;
export const STATUS = { up: 0, degraded: 1, down: 2 } as const;
export type NodeStatus = keyof typeof STATUS;

export const POSITION_STRIDE = 8;
export const EDGE_STRIDE = 8;
export const RECOMMENDED_MAX_NODES = 5_000;

export interface RawTopologyNode {
  readonly id?: string;
  readonly label?: string;
  readonly kind: NodeKind;
  readonly status: NodeStatus;
}
export interface RawTopologyEdge {
  readonly source: number;
  readonly target: number;
  readonly health: number;
  readonly traffic: number;
}
export interface TopologyInput {
  readonly nodes: readonly RawTopologyNode[];
  readonly edges: readonly RawTopologyEdge[];
  readonly seed?: number;
}

export interface TopologyData {
  readonly nodeCount: number;
  readonly positions: Float32Array<ArrayBuffer>;
  readonly kind: Uint8Array;
  readonly status: Uint8Array;
  readonly edges: Uint32Array<ArrayBuffer>;
  readonly edgeCount: number;
  readonly edgeHealth: Float32Array<ArrayBuffer>;
  readonly edgeTraffic: Float32Array<ArrayBuffer>;
  readonly adjacencyStarts: Uint32Array<ArrayBuffer>;
  readonly adjacencyItems: Uint32Array<ArrayBuffer>;
  readonly labels: readonly string[];
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function ingestTopology(input: TopologyInput): {
  readonly topology: TopologyData;
  readonly droppedEdges: number;
} {
  const nodeCount = input.nodes.length;
  if (nodeCount === 0) {
    throw new RangeError("gpu-components/networktopology: at least one node is required");
  }

  const rnd = mulberry32(input.seed ?? 0x9e3779b9);
  const positions = new Float32Array(new ArrayBuffer(nodeCount * 2 * 4));
  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / nodeCount) * Math.PI * 2;
    const radius = 0.35 + rnd() * 0.15;
    positions[i * 2] = Math.cos(angle) * radius + (rnd() - 0.5) * 0.05;
    positions[i * 2 + 1] = Math.sin(angle) * radius + (rnd() - 0.5) * 0.05;
  }

  const kind = new Uint8Array(nodeCount);
  const status = new Uint8Array(nodeCount);
  const labels: string[] = new Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const node = input.nodes[i]!;
    kind[i] = KIND[node.kind];
    status[i] = STATUS[node.status];
    labels[i] = node.label ?? "";
  }

  const kept: RawTopologyEdge[] = [];
  let droppedEdges = 0;
  for (const edge of input.edges) {
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
  const edgeHealth = new Float32Array(new ArrayBuffer(kept.length * 4));
  const edgeTraffic = new Float32Array(new ArrayBuffer(kept.length * 4));
  const degree = new Uint32Array(nodeCount);
  kept.forEach((edge, i) => {
    edges[i * 2] = edge.source;
    edges[i * 2 + 1] = edge.target;
    edgeHealth[i] = clamp01(edge.health);
    edgeTraffic[i] = clamp01(edge.traffic);
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
    topology: {
      nodeCount,
      positions,
      kind,
      status,
      edges,
      edgeCount: kept.length,
      edgeHealth,
      edgeTraffic,
      adjacencyStarts,
      adjacencyItems,
      labels,
    },
    droppedEdges,
  };
}
