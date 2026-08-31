/**
 * Adaptive histogram binning — Freedman–Diaconis with Sturges fallback.
 * Pure CPU, once per dataset (PLAN.md §5.2).
 */

/** Hard ceiling on bucket count — §24.2. */
export const MAX_BINS = 512;

/** Sorted copy of finite values only. */
export function finiteSorted(values: Float32Array, count: number): Float32Array {
  const tmp: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) tmp.push(v);
  }
  tmp.sort((a, b) => a - b);
  return Float32Array.from(tmp);
}

/** Inclusive percentile on a sorted array (linear index). */
export function percentileSorted(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const t = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const lo = Math.floor(t);
  const hi = Math.ceil(t);
  if (lo === hi) return sorted[lo]!;
  const f = t - lo;
  return sorted[lo]! * (1 - f) + sorted[hi]! * f;
}

export function interquartileRange(sorted: Float32Array): number {
  if (sorted.length < 2) return 0;
  return percentileSorted(sorted, 0.75) - percentileSorted(sorted, 0.25);
}

/** Sturges' rule: ceil(log2(n)) + 1. */
export function sturgesBinCount(n: number): number {
  if (n < 1) return 1;
  return Math.max(1, Math.ceil(Math.log2(n)) + 1);
}

/**
 * Freedman–Diaconis bin count over `[domainMin, domainMax]`.
 * Returns null when IQR is unusable so the caller can fall back to Sturges.
 */
export function freedmanDiaconisBinCount(
  n: number,
  iqr: number,
  domainMin: number,
  domainMax: number,
): number | null {
  if (n < 2 || !(iqr > 0)) return null;
  const span = domainMax - domainMin;
  if (!(span > 0)) return null;
  const width = 2 * iqr * n ** (-1 / 3);
  if (!(width > 0)) return null;
  return Math.max(1, Math.ceil(span / width));
}

export function clampBinCount(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_BINS, Math.max(1, Math.floor(n)));
}

/**
 * Chooses bin count: optional override, else Freedman–Diaconis, else Sturges; then clamp.
 */
export function resolveBinCount(
  n: number,
  iqr: number,
  domainMin: number,
  domainMax: number,
  override?: number,
): { readonly binCount: number; readonly method: "override" | "freedman-diaconis" | "sturges" } {
  if (override !== undefined) {
    return { binCount: clampBinCount(override), method: "override" };
  }
  const fd = freedmanDiaconisBinCount(n, iqr, domainMin, domainMax);
  if (fd != null) {
    return { binCount: clampBinCount(fd), method: "freedman-diaconis" };
  }
  return { binCount: clampBinCount(sturgesBinCount(n)), method: "sturges" };
}

/** CPU histogram oracle — same bin edges as the GPU kernel. */
export function cpuHistogram(
  values: Float32Array,
  count: number,
  domainMin: number,
  domainMax: number,
  binCount: number,
): Uint32Array {
  const bins = new Uint32Array(binCount);
  const span = Math.max(domainMax - domainMin, 1e-20);
  for (let i = 0; i < count; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < domainMin || v > domainMax) continue;
    let b = Math.floor(((v - domainMin) / span) * binCount);
    if (b >= binCount) b = binCount - 1;
    if (b < 0) b = 0;
    bins[b]!++;
  }
  return bins;
}
