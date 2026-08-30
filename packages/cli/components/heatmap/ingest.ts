/**
 * `GPUHeatmap`'s data model (PLAN.md §29 Phase 5). Columnar by construction — a dense matrix is
 * already the ideal GPU shape: one `Float32Array` of values, uploaded once, re-rendered from a
 * changed uniform (§5, gate 3).
 *
 * Unlike `registry/timeline`'s `ingestSpans`, there is no sort and no spatial index to build: a
 * matrix cell's position *is* its index, so hit-testing is arithmetic rather than search. That is a
 * genuine difference between the two components and the reason this one exercises `core`'s
 * *rendering* and *compute* surfaces rather than its interaction ones.
 */

export interface HeatmapData {
  /** Row-major, `rows * cols` values. NaN marks a missing cell (rendered transparent). */
  /** `<ArrayBuffer>` explicitly: these bytes go straight to `StorageBuffer.write`, whose
   * `BufferSource` parameter does not accept the default `ArrayBufferLike` widening. */
  readonly values: Float32Array<ArrayBuffer>;
  readonly rows: number;
  readonly cols: number;
  /** Optional per-row / per-column names, used by the label overlay and the a11y tree. */
  readonly rowLabels?: readonly string[];
  readonly colLabels?: readonly string[];
}

export interface HeatmapCell {
  readonly row: number;
  readonly col: number;
  readonly value: number;
}

/** Bytes per value in the GPU storage buffer — plain `f32`. */
export const VALUE_STRIDE = 4;

/**
 * Validates and wraps a raw matrix (PLAN.md §24.2: validate at ingest, before anything reaches the
 * GPU). Non-finite values are *kept* rather than dropped — in a matrix, a hole is meaningful and
 * has a position — but they are excluded from the range reduction and drawn transparent, so a
 * single NaN cannot blow out the colour scale for every other cell.
 */
export function ingestMatrix(
  values: Float32Array | readonly number[],
  rows: number,
  cols: number,
  labels?: { rowLabels?: readonly string[]; colLabels?: readonly string[] },
): HeatmapData {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0) {
    throw new RangeError(`gpu-components/heatmap: rows and cols must be positive integers, got ${rows}x${cols}`);
  }
  const expected = rows * cols;
  if (values.length !== expected) {
    throw new RangeError(
      `gpu-components/heatmap: expected ${expected} values for a ${rows}x${cols} matrix, got ${values.length}`,
    );
  }
  const typed: Float32Array<ArrayBuffer> =
    values instanceof Float32Array ? (values as Float32Array<ArrayBuffer>) : Float32Array.from(values);
  return {
    values: typed,
    rows,
    cols,
    rowLabels: labels?.rowLabels,
    colLabels: labels?.colLabels,
  };
}

/** Row-major index of a cell. */
export function cellIndex(data: HeatmapData, row: number, col: number): number {
  return row * data.cols + col;
}

/** CPU reference for the GPU reduction — also the fallback path's range source. Ignores non-finite
 * values; returns `[0, 1]` for an all-empty matrix so the colour scale never divides by zero. */
export function computeRange(data: HeatmapData): readonly [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < data.values.length; i++) {
    const v = data.values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}
