/**
 * `GPUScatter`'s data model — PLAN.md §6.2's second-highest-scoring candidate (136.0), and the one
 * that scores a perfect 10 on demonstrable performance delta.
 *
 * Columnar from the start: x, y and category as parallel typed arrays, uploaded once and never
 * re-walked. §5's gate 3 in its purest form — pan, zoom, recolour and filter are all uniform writes
 * over an immutable buffer.
 */

/** Bytes per point on the GPU: x, y (f32) + category (u32) + padding to a 16-byte stride. */
export const POINT_STRIDE = 16;

export interface ScatterData {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Small integer category per point, used for colour. */
  readonly category: Uint8Array;
  readonly count: number;
  /** Data extent, computed once at ingest — the default viewport and the axis range. */
  readonly bounds: { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number };
  /** Optional per-category names, for the legend and the accessibility summary. */
  readonly categoryNames?: readonly string[];
}

export interface RawPoint {
  readonly x: number;
  readonly y: number;
  readonly category?: number;
}

/**
 * Extent over both axes, skipping non-finite points.
 *
 * CPU, and deliberately so even though this is a reduction over millions of values: it runs **once
 * per dataset**, not per frame, and §5.2 is explicit that one-time work at ingest stays off the GPU.
 * The heatmap's reduction is on the GPU because it re-runs whenever the data changes underneath a
 * live view; this one cannot.
 */
export function computeBounds(x: Float32Array, y: Float32Array, count: number): ScatterData["bounds"] {
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
  // A degenerate axis would divide by zero in the viewport transform.
  if (xMin === xMax) xMax = xMin + 1;
  if (yMin === yMax) yMax = yMin + 1;
  return { xMin, xMax, yMin, yMax };
}

/** Columnar fast path — the form §17.1 documents as the one that scales. */
export function ingestColumns(
  x: Float32Array,
  y: Float32Array,
  category?: Uint8Array,
  categoryNames?: readonly string[],
): ScatterData {
  if (x.length !== y.length) {
    throw new RangeError(`gpu-components/scatter: x and y must be the same length, got ${x.length} and ${y.length}`);
  }
  const count = x.length;
  return {
    x,
    y,
    category: category ?? new Uint8Array(count),
    count,
    bounds: computeBounds(x, y, count),
    categoryNames,
  };
}

/** Ergonomic path — objects in, columnar out, with the conversion cost documented (§17.1). */
export function ingestPoints(points: readonly RawPoint[], categoryNames?: readonly string[]): ScatterData {
  const count = points.length;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const category = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const point = points[i]!;
    x[i] = point.x;
    y[i] = point.y;
    category[i] = point.category ?? 0;
  }
  return ingestColumns(x, y, category, categoryNames);
}

/** Packs points for the GPU. Positions stay in data space; the viewport transform does the rest. */
export function packPoints(data: ScatterData): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(data.count * POINT_STRIDE));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < data.count; i++) {
    const at = i * POINT_STRIDE;
    view.setFloat32(at + 0, data.x[i]!, true);
    view.setFloat32(at + 4, data.y[i]!, true);
    view.setUint32(at + 8, data.category[i]!, true);
    view.setUint32(at + 12, 0, true);
  }
  return bytes;
}
