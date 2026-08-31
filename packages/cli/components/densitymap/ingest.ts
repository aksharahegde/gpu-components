/**
 * `GPUDensityMap` data model — columnar lon/lat projected once at ingest into Web Mercator
 * metres (see `mercator.ts`). After upload the CPU never re-walks the points: pan, zoom and
 * hex size are uniform / layout writes over an immutable buffer.
 */

import { lonLatToMercator } from "./mercator.ts";

/** Bytes per point on the GPU: x, y, weight (f32) + pad — 16-byte stride. */
export const POINT_STRIDE = 16;

export interface DensityMapData {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Per-point weight; defaults to 1. GPU bins round to u32 for atomics. */
  readonly weight: Float32Array;
  readonly count: number;
  readonly bounds: {
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
  };
}

export interface RawLonLat {
  readonly lon: number;
  readonly lat: number;
  readonly weight?: number;
}

export function computeBounds(x: Float32Array, y: Float32Array, count: number): DensityMapData["bounds"] {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < count; i++) {
    const px = x[i]!;
    const py = y[i]!;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    if (px < xMin) xMin = px;
    if (px > xMax) xMax = px;
    if (py < yMin) yMin = py;
    if (py > yMax) yMax = py;
  }

  if (xMin > xMax) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  if (xMin === xMax) xMax = xMin + 1;
  if (yMin === yMax) yMax = yMin + 1;
  return { xMin, xMax, yMin, yMax };
}

/**
 * Columnar lon/lat → projected `DensityMapData`. Non-finite or out-of-range lon is skipped
 * (holes); lat is clamped inside `lonLatToMercator`.
 */
export function ingestLonLat(
  lon: Float32Array,
  lat: Float32Array,
  weight?: Float32Array,
): DensityMapData {
  if (lon.length !== lat.length) {
    throw new RangeError(
      `gpu-components/densitymap: lon and lat must be the same length, got ${lon.length} and ${lat.length}`,
    );
  }
  if (weight && weight.length !== lon.length) {
    throw new RangeError(
      `gpu-components/densitymap: weight length ${weight.length} does not match lon/lat ${lon.length}`,
    );
  }

  const n = lon.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const w = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const lo = lon[i]!;
    const la = lat[i]!;
    if (!Number.isFinite(lo) || !Number.isFinite(la) || lo < -180 || lo > 180) {
      x[i] = Number.NaN;
      y[i] = Number.NaN;
      w[i] = 0;
      continue;
    }
    const p = lonLatToMercator(lo, la);
    x[i] = p.x;
    y[i] = p.y;
    const wi = weight?.[i] ?? 1;
    w[i] = Number.isFinite(wi) && wi > 0 ? wi : 0;
  }

  return { x, y, weight: w, count: n, bounds: computeBounds(x, y, n) };
}

/** Object-array convenience path — fine for demos; prefer `ingestLonLat` at scale. */
export function ingestPoints(points: readonly RawLonLat[]): DensityMapData {
  const lon = new Float32Array(points.length);
  const lat = new Float32Array(points.length);
  const weight = new Float32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    lon[i] = points[i]!.lon;
    lat[i] = points[i]!.lat;
    weight[i] = points[i]!.weight ?? 1;
  }
  return ingestLonLat(lon, lat, weight);
}

/** Packs points for the hexbin compute storage buffer. */
export function packPoints(data: DensityMapData): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(data.count * POINT_STRIDE));
  for (let i = 0; i < data.count; i++) {
    const at = i * 4;
    out[at] = data.x[i]!;
    out[at + 1] = data.y[i]!;
    out[at + 2] = data.weight[i]!;
    out[at + 3] = 0;
  }
  return out;
}
