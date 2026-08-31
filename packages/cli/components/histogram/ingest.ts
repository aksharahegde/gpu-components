/**
 * `GPUHistogram` data model — columnar values, domain and adaptive bin layout computed once
 * at ingest (Freedman–Diaconis / Sturges). After upload the GPU only rebins and draws.
 */

import {
  clampBinCount,
  finiteSorted,
  interquartileRange,
  resolveBinCount,
  MAX_BINS,
} from "./bins.ts";

export const VALUE_STRIDE = 4;

export interface HistogramDomain {
  readonly min: number;
  readonly max: number;
}

export interface HistogramData {
  readonly values: Float32Array;
  readonly count: number;
  readonly domain: HistogramDomain;
  readonly binCount: number;
  readonly binWidth: number;
  readonly method: "override" | "freedman-diaconis" | "sturges";
  /** Finite sample count used for adaptive rules (may be less than `count` when holes exist). */
  readonly finiteCount: number;
}

export interface IngestOptions {
  readonly binCount?: number;
}

export function computeDomain(values: Float32Array, count: number): HistogramDomain {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return { min: 0, max: 1 };
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}

export function ingestValues(values: Float32Array, opts?: IngestOptions): HistogramData {
  const count = values.length;
  const domain = computeDomain(values, count);
  const sorted = finiteSorted(values, count);
  const finiteCount = sorted.length;
  const iqr = interquartileRange(sorted);
  const resolved = resolveBinCount(finiteCount, iqr, domain.min, domain.max, opts?.binCount);
  const binCount = resolved.binCount;
  const span = domain.max - domain.min;
  const binWidth = span / binCount;
  return {
    values,
    count,
    domain,
    binCount,
    binWidth,
    method: resolved.method,
    finiteCount,
  };
}

/** Object-array convenience for demos and small fixtures. */
export function ingestNumbers(values: readonly number[], opts?: IngestOptions): HistogramData {
  return ingestValues(Float32Array.from(values), opts);
}

/**
 * Re-layout bins with an explicit count over the same values/domain — used when the React
 * prop overrides ingest's adaptive choice without rebuilding the value buffer.
 */
export function withBinCount(data: HistogramData, binCount: number): HistogramData {
  const n = clampBinCount(binCount);
  const span = data.domain.max - data.domain.min;
  return {
    ...data,
    binCount: n,
    binWidth: span / n,
    method: "override",
  };
}

export function packValues(data: HistogramData): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(data.count * VALUE_STRIDE));
  out.set(data.values.subarray(0, data.count));
  return out;
}

export { MAX_BINS };
