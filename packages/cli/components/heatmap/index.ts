export { ingestMatrix, cellIndex, computeRange, VALUE_STRIDE } from "./ingest.ts";
export type { HeatmapCell, HeatmapData } from "./ingest.ts";
export { buildColormapLut, colormapKey, LUT_SIZE } from "./colormap.ts";
export type { ColormapName } from "./colormap.ts";
export { HeatmapComponent } from "./HeatmapComponent.ts";
export type { HeatmapProps } from "./HeatmapComponent.ts";
export { GPUHeatmap } from "./GPUHeatmap.tsx";
export type { GPUHeatmapProps } from "./GPUHeatmap.tsx";
