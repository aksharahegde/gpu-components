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
  readonly trackCount: number;
  /** CSS pixels of the canvas this viewport maps onto. */
  readonly width: number;
  readonly height: number;
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

/** scale/offset such that `track * scale + offset` lands on that row's clip-space vertical center,
 * track 0 at the top (clip y near +1), `trackCount - 1` at the bottom (clip y near -1). */
function trackToClipScaleOffset(v: ViewportState): readonly [number, number] {
  const count = v.trackCount || 1;
  const scale = -2 / count;
  const offset = 1 - 1 / count;
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
  const count = v.trackCount || 1;
  return ((track + 0.5) / count) * v.height;
}

/** CSS-pixel height of one track row. */
export function trackRowHeight(v: ViewportState): number {
  return v.height / (v.trackCount || 1);
}
