/**
 * `GPUDepGraph` data model — directed dependency graphs laid out once at ingest
 * (Sugiyama + orthogonal routes in `layout.ts`).
 */

import { layoutDepGraph, type LaidOutGraph, MAX_EDGES, MAX_NODES } from "./layout.ts";

export { MAX_EDGES, MAX_NODES };

/** Bytes per node instance: x, y (f32) + category (u32) + flags (u32). */
export const NODE_STRIDE = 16;

export const NODE_FLAG_ROOT = 1;
export const NODE_FLAG_BACK_EDGE_ENDPOINT = 2;

export interface RawDepNode {
  readonly id?: string;
  readonly label?: string;
  readonly category?: number;
}

export interface RawDepEdge {
  readonly source: number;
  readonly target: number;
}

export interface DepGraphInput {
  readonly nodes: readonly RawDepNode[];
  readonly edges: readonly RawDepEdge[];
}

export interface DepGraphData extends LaidOutGraph {
  readonly labels: readonly string[];
}

/**
 * Validates endpoints, caps size, runs Sugiyama layout, and returns GPU-ready buffers.
 */
export function ingestDepGraph(input: DepGraphInput): DepGraphData {
  const nodeCount = input.nodes.length;
  if (nodeCount === 0) {
    throw new RangeError("gpu-components/depgraph: at least one node is required");
  }
  if (nodeCount > MAX_NODES) {
    throw new RangeError(
      `gpu-components/depgraph: at most ${MAX_NODES} nodes, got ${nodeCount}`,
    );
  }
  if (input.edges.length > MAX_EDGES) {
    throw new RangeError(
      `gpu-components/depgraph: at most ${MAX_EDGES} edges, got ${input.edges.length}`,
    );
  }

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
      throw new RangeError(
        `gpu-components/depgraph: edge ${i} endpoints out of range (${e.source}→${e.target})`,
      );
    }
  }

  const categories = new Uint8Array(nodeCount);
  const labels: string[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const n = input.nodes[i]!;
    categories[i] = (n.category ?? 0) & 255;
    labels.push(n.label ?? n.id ?? `n${i}`);
  }

  const laid = layoutDepGraph({
    nodeCount,
    edges: input.edges.map((e) => ({ source: e.source, target: e.target })),
    categories,
  });

  return { ...laid, labels };
}

/** Packs node instances for `InstancedQuadLayer`. */
export function packNodes(data: DepGraphData): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(data.nodeCount * NODE_STRIDE));
  const view = new DataView(out.buffer);
  for (let i = 0; i < data.nodeCount; i++) {
    const at = i * NODE_STRIDE;
    view.setFloat32(at + 0, data.x[i]!, true);
    view.setFloat32(at + 4, data.y[i]!, true);
    view.setUint32(at + 8, data.category[i]!, true);
    view.setUint32(at + 12, data.flags[i]!, true);
  }
  return out;
}
