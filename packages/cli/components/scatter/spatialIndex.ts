import type { ScatterData } from "./ingest.ts";

/**
 * A uniform-grid spatial index over the point cloud, built once per dataset.
 *
 * **This file is an argument with PLAN.md §9.5.** That section routes hover and click for "graph
 * nodes and dense scatter" to *asynchronous GPU ID-buffer picking*, on the stated grounds that they
 * "have no cheap CPU index", and reserves `core`'s (still unbuilt) `Picker` for exactly this case.
 *
 * For a scatter plot that claim does not hold. The points are immutable and their positions never
 * change — only the viewport does — so a uniform grid bucketed over the data bounds is built once,
 * costs O(n) to construct and O(1) to query, and gives an **exact, same-frame** answer. GPU picking
 * would be a render pass, a readback and one frame of latency, to answer a question a `Uint32Array`
 * already answers instantly. §9.5's own rule — "CPU by default… this is *better* than GPU picking,
 * not a fallback from it" — applies here more strongly than the sentence that excludes scatter from
 * it.
 *
 * Where GPU picking would still earn its place: a force-directed graph, where positions change
 * every frame and the index would have to be rebuilt every frame. That is a real case, and it is
 * the one `core`'s `Picker` should be designed against — not this one.
 *
 * Memory: two `Uint32Array`s totalling `(cells + 1 + count)` words, about 4MB at 1M points.
 */

export interface SpatialIndex {
  readonly cols: number;
  readonly rows: number;
  /** CSR-style bucket starts, `cols * rows + 1` entries. */
  readonly starts: Uint32Array;
  /** Point indices, grouped by bucket. */
  readonly items: Uint32Array;
  readonly bounds: ScatterData["bounds"];
}

/** Target average occupancy per bucket. Low enough that a query scans a handful of points. */
const TARGET_PER_CELL = 4;
/** Keeps the grid from exploding on huge datasets — 1M cells is 4MB of starts. */
const MAX_CELLS = 1_000_000;

/** Builds the index. O(n) with two passes: count, then scatter. */
export function buildSpatialIndex(data: ScatterData): SpatialIndex {
  const { bounds, count } = data;
  const target = Math.max(1, Math.min(MAX_CELLS, Math.ceil(count / TARGET_PER_CELL)));
  const side = Math.max(1, Math.floor(Math.sqrt(target)));
  const cols = side;
  const rows = side;
  const cells = cols * rows;

  const spanX = bounds.xMax - bounds.xMin || 1;
  const spanY = bounds.yMax - bounds.yMin || 1;

  const cellOf = (i: number): number => {
    const px = data.x[i]!;
    const py = data.y[i]!;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return -1;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(((px - bounds.xMin) / spanX) * cols)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(((py - bounds.yMin) / spanY) * rows)));
    return cy * cols + cx;
  };

  const counts = new Uint32Array(cells + 1);
  for (let i = 0; i < count; i++) {
    const cell = cellOf(i);
    if (cell >= 0) counts[cell + 1]!++;
  }
  for (let c = 0; c < cells; c++) counts[c + 1]! += counts[c]!;

  const starts = counts;
  const items = new Uint32Array(count);
  const cursor = new Uint32Array(cells);
  for (let i = 0; i < count; i++) {
    const cell = cellOf(i);
    if (cell < 0) continue;
    items[starts[cell]! + cursor[cell]!] = i;
    cursor[cell]!++;
  }

  return { cols, rows, starts, items, bounds };
}

/**
 * Nearest point to `(x, y)` in data space, within `radius` data units, or `null`.
 *
 * Scans the bucket under the query plus every bucket the radius touches, so the answer is exact
 * rather than "nearest in this cell".
 */
export function nearestPoint(
  index: SpatialIndex,
  data: ScatterData,
  x: number,
  y: number,
  radius: number,
): number | null {
  const { bounds, cols, rows } = index;
  const spanX = bounds.xMax - bounds.xMin || 1;
  const spanY = bounds.yMax - bounds.yMin || 1;

  const cellW = spanX / cols;
  const cellH = spanY / rows;
  const minCx = Math.max(0, Math.floor(((x - radius - bounds.xMin) / spanX) * cols));
  const maxCx = Math.min(cols - 1, Math.floor(((x + radius - bounds.xMin) / spanX) * cols));
  const minCy = Math.max(0, Math.floor(((y - radius - bounds.yMin) / spanY) * rows));
  const maxCy = Math.min(rows - 1, Math.floor(((y + radius - bounds.yMin) / spanY) * rows));
  if (minCx > maxCx || minCy > maxCy) return null;
  // Unused beyond documenting intent, but keeps the cell size visible to a reader.
  void cellW;
  void cellH;

  let best: number | null = null;
  let bestDist = radius * radius;

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const cell = cy * cols + cx;
      const from = index.starts[cell]!;
      const to = index.starts[cell + 1]!;
      for (let k = from; k < to; k++) {
        const i = index.items[k]!;
        const dx = data.x[i]! - x;
        const dy = data.y[i]! - y;
        const dist = dx * dx + dy * dy;
        if (dist <= bestDist) {
          bestDist = dist;
          best = i;
        }
      }
    }
  }
  return best;
}

/** Every point inside an axis-aligned data-space rectangle — the brush query. */
export function pointsInRect(
  index: SpatialIndex,
  data: ScatterData,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
): number[] {
  const found: number[] = [];
  const { bounds, cols, rows } = index;
  const spanX = bounds.xMax - bounds.xMin || 1;
  const spanY = bounds.yMax - bounds.yMin || 1;

  const minCx = Math.max(0, Math.floor(((xMin - bounds.xMin) / spanX) * cols));
  const maxCx = Math.min(cols - 1, Math.floor(((xMax - bounds.xMin) / spanX) * cols));
  const minCy = Math.max(0, Math.floor(((yMin - bounds.yMin) / spanY) * rows));
  const maxCy = Math.min(rows - 1, Math.floor(((yMax - bounds.yMin) / spanY) * rows));

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const cell = cy * cols + cx;
      for (let k = index.starts[cell]!; k < index.starts[cell + 1]!; k++) {
        const i = index.items[k]!;
        const px = data.x[i]!;
        const py = data.y[i]!;
        if (px >= xMin && px <= xMax && py >= yMin && py <= yMax) found.push(i);
      }
    }
  }
  return found;
}
