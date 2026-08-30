export { ingestColumns, ingestPoints, computeBounds, packPoints, POINT_STRIDE } from "./ingest.ts";
export type { RawPoint, ScatterData } from "./ingest.ts";
export { buildSpatialIndex, nearestPoint, pointsInRect } from "./spatialIndex.ts";
export type { SpatialIndex } from "./spatialIndex.ts";
export { ScatterComponent } from "./ScatterComponent.ts";
export type { ScatterProps } from "./ScatterComponent.ts";
export { GPUScatter } from "./GPUScatter.tsx";
export type { GPUScatterProps } from "./GPUScatter.tsx";
