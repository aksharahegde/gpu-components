export { ingestDepGraph, packNodes, NODE_STRIDE, NODE_FLAG_ROOT, MAX_NODES, MAX_EDGES } from "./ingest.ts";
export type { DepGraphData, DepGraphInput, RawDepNode, RawDepEdge } from "./ingest.ts";
export { layoutDepGraph, MAX_LINE_SEGMENTS } from "./layout.ts";
export type { LaidOutGraph, EdgeSegment, LayoutEdge } from "./layout.ts";
export { DepGraphComponent } from "./DepGraphComponent.ts";
export type { DepGraphProps } from "./DepGraphComponent.ts";
export { GPUDepGraph } from "./GPUDepGraph.tsx";
export type { GPUDepGraphProps } from "./GPUDepGraph.tsx";
