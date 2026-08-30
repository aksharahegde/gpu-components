/**
 * The viewport model shared by every 2D data component (PLAN.md §12.3) — not Timeline-specific.
 * Pan/zoom is changing `ViewportState` and re-deriving `ViewportUniforms`: one uniform write, never
 * a data re-walk. The pixel-space helpers below use the exact same scale/offset math as the clip-
 * space uniforms, which is what lets a DOM label overlay stay pixel-identical to the shader without
 * duplicating the transform logic (PLAN.md §21).
 */

export interface ViewportState {
  /** Domain start/end — seconds, or a normalized [0,1] range; whatever unit the caller's spans use. */
  readonly timeStart: number;
  readonly timeEnd: number;
  /** Total rows in the dataset. Also the default y extent when `rowStart`/`rowEnd` are omitted. */
  readonly trackCount: number;
  /**
   * Visible row range, exclusive of `rowEnd` — the y-axis equivalent of `timeStart`/`timeEnd`.
   *
   * Omit both (the Timeline's case) and the viewport shows every row at once, which is the
   * behaviour this model had before vertical panning existed: `[0, trackCount]`. Supply them and
   * the y axis pans and zooms exactly as x does.
   *
   * Added for `GPUHeatmap` (PLAN.md §29 Phase 5), whose two axes are both continuous. The
   * generalisation is deliberately arithmetic-compatible: at `[0, trackCount]` the derived
   * scale/offset are *identical* to what this function produced before, so every existing shader,
   * label placement and hit-test keeps its exact pixel behaviour. See
   * `registry/heatmap/CORE-WISHLIST.md` for why the fuller rename this implies is still deferred.
   */
  readonly rowStart?: number;
  readonly rowEnd?: number;
  /**
   * Treat the y axis as a **continuous coordinate** rather than a row index.
   *
   * The default mapping places row `i` at the *centre* of its band — the extra `-1/span` in the
   * offset below — which is what a timeline's tracks and a heatmap's or grid's rows all want: row 0
   * should sit half a row down from the top edge, not on it. A scatter plot's y is not an index; it
   * is a value, and `y = yMin` must land exactly on the bottom edge. Without this flag a scatter's
   * points are shifted half a band and its top row falls off the surface entirely — which is how
   * this option came to exist.
   */
  readonly yContinuous?: boolean;
  /** CSS pixels of the canvas this viewport maps onto. */
  readonly width: number;
  readonly height: number;
}

/** The visible row range, defaulting to "all of them" for callers that never set one. */
export function rowRange(v: ViewportState): readonly [number, number] {
  const start = v.rowStart ?? 0;
  const end = v.rowEnd ?? v.trackCount;
  return end > start ? [start, end] : [start, start + 1];
}

/** How many rows are visible — the y-axis counterpart of `timeEnd - timeStart`. */
export function visibleRows(v: ViewportState): number {
  const [start, end] = rowRange(v);
  return end - start;
}

export interface ViewportUniforms extends Record<string, unknown> {
  readonly timeToClip: readonly [number, number];
  readonly trackToClip: readonly [number, number];
  readonly pxSize: readonly [number, number];
}

/** scale/offset such that `time * scale + offset` lands in clip space [-1, 1] over [timeStart, timeEnd]. */
function timeToClipScaleOffset(v: ViewportState): readonly [number, number] {
  const span = v.timeEnd - v.timeStart || 1;
  const scale = 2 / span;
  const offset = -1 - v.timeStart * scale;
  return [scale, offset];
}

/**
 * scale/offset such that `track * scale + offset` lands on that row's clip-space vertical center,
 * with the first visible row at the top (clip y near +1) and the last at the bottom (near -1).
 *
 * The shader passes a row *index* and this bakes the half-row centring in, which is why the offset
 * carries a `- 1/span` term. Written generally over the visible row range: at `[0, trackCount]` it
 * reduces to the original `[-2/count, 1 - 1/count]` exactly, so nothing that predates vertical
 * panning changes by a single ulp.
 */
function trackToClipScaleOffset(v: ViewportState): readonly [number, number] {
  const [start, end] = rowRange(v);
  const span = end - start || 1;
  const scale = -2 / span;
  // The `- 1` is the half-band centring for index-shaped axes; a continuous axis omits it.
  const offset = 1 + (2 * start - (v.yContinuous ? 0 : 1)) / span;
  return [scale, offset];
}

export function viewportUniforms(v: ViewportState): ViewportUniforms {
  return {
    timeToClip: timeToClipScaleOffset(v),
    trackToClip: trackToClipScaleOffset(v),
    pxSize: [2 / (v.width || 1), 2 / (v.height || 1)],
  };
}

/** CSS-pixel x within the canvas, left edge, for a point in the time domain. For the DOM label
 * overlay — screen pixels, not clip space. */
export function timeToPixelX(v: ViewportState, t: number): number {
  const span = v.timeEnd - v.timeStart || 1;
  return ((t - v.timeStart) / span) * v.width;
}

/** CSS-pixel y within the canvas, top edge, of a track's row center. */
export function trackToPixelY(v: ViewportState, track: number): number {
  const [start, end] = rowRange(v);
  const centre = v.yContinuous ? 0 : 0.5;
  return ((track + centre - start) / (end - start)) * v.height;
}

/** CSS-pixel height of one track row. */
export function trackRowHeight(v: ViewportState): number {
  return v.height / visibleRows(v);
}

/** Inverse of `timeToPixelX` — the time value under a given CSS-pixel x. For hit-testing and
 * zoom-at-cursor, where the pointer gives pixels and everything else works in the time domain. */
export function pixelXToTime(v: ViewportState, pixelX: number): number {
  const span = v.timeEnd - v.timeStart || 1;
  return v.timeStart + (pixelX / (v.width || 1)) * span;
}

/** Inverse of `trackToPixelY` — the (fractional) track index under a given CSS-pixel y. Callers
 * that need a discrete track for hit-testing round this themselves (`Math.round`), since a caller
 * comparing against row boundaries may want floor/ceil instead. */
export function pixelYToTrack(v: ViewportState, pixelY: number): number {
  const [start, end] = rowRange(v);
  const centre = v.yContinuous ? 0 : 0.5;
  return start + (pixelY / (v.height || 1)) * (end - start) - centre;
}
