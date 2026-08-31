export {
  ingestValues,
  ingestNumbers,
  computeDomain,
  packValues,
  withBinCount,
  VALUE_STRIDE,
  MAX_BINS,
} from "./ingest.ts";
export type { HistogramData, HistogramDomain, IngestOptions } from "./ingest.ts";
export {
  resolveBinCount,
  freedmanDiaconisBinCount,
  sturgesBinCount,
  interquartileRange,
  cpuHistogram,
  finiteSorted,
  clampBinCount,
} from "./bins.ts";
export { HistogramComponent } from "./HistogramComponent.ts";
export type { HistogramProps } from "./HistogramComponent.ts";
export { GPUHistogram } from "./GPUHistogram.tsx";
export type { GPUHistogramProps } from "./GPUHistogram.tsx";
export { computeAxisRules, MAX_AXIS_RULES } from "./axisRules.ts";
