import { pixelXToTime } from "../viewport.ts";
import type { ViewportState } from "../viewport.ts";

/** The data's own time range — pan/zoom never moves the viewport outside it (PLAN.md §9.5's
 * `viewport.ts` "clamping" responsibility; inertia is deferred). */
export interface ViewportBounds {
  readonly timeMin: number;
  readonly timeMax: number;
}

export interface ViewportController {
  getState(): ViewportState;
  /** Zooms by `factor` (>1 zooms out, <1 zooms in), keeping the time value under `pixelX` fixed on
   * screen — the standard "zoom toward pointer" transform. */
  zoomAt(pixelX: number, factor: number): void;
  /** Shifts the domain so that a screen-space drag of `deltaX` pixels tracks the pointer. */
  panByPixels(deltaX: number): void;
  resize(width: number, height: number): void;
}

/** Zooming in past this fraction of the full bounds is not allowed — an arbitrary but sane floor
 * (prevents a runaway zoom from collapsing the domain to zero width). */
const MIN_SPAN_FRACTION = 1e-4;

function clampSpan(state: ViewportState, bounds: ViewportBounds): ViewportState {
  const boundsWidth = bounds.timeMax - bounds.timeMin || 1;
  const minSpan = boundsWidth * MIN_SPAN_FRACTION;
  let span = state.timeEnd - state.timeStart;
  span = Math.min(Math.max(span, minSpan), boundsWidth);

  let timeStart = state.timeStart;
  let timeEnd = timeStart + span;
  if (timeStart < bounds.timeMin) {
    timeStart = bounds.timeMin;
    timeEnd = timeStart + span;
  }
  if (timeEnd > bounds.timeMax) {
    timeEnd = bounds.timeMax;
    timeStart = timeEnd - span;
  }
  return { ...state, timeStart, timeEnd };
}

export function createViewportController(
  initial: ViewportState,
  bounds: ViewportBounds,
): ViewportController {
  let state = clampSpan(initial, bounds);

  return {
    getState() {
      return state;
    },
    zoomAt(pixelX, factor) {
      const targetTime = pixelXToTime(state, pixelX);
      const currentSpan = state.timeEnd - state.timeStart || 1;
      const boundsWidth = bounds.timeMax - bounds.timeMin || 1;
      const newSpan = Math.min(
        Math.max(currentSpan * factor, boundsWidth * MIN_SPAN_FRACTION),
        boundsWidth,
      );
      const fraction = pixelX / (state.width || 1);
      const timeStart = targetTime - fraction * newSpan;
      state = clampSpan({ ...state, timeStart, timeEnd: timeStart + newSpan }, bounds);
    },
    panByPixels(deltaX) {
      const span = state.timeEnd - state.timeStart;
      const dt = (deltaX / (state.width || 1)) * span;
      state = clampSpan(
        { ...state, timeStart: state.timeStart + dt, timeEnd: state.timeEnd + dt },
        bounds,
      );
    },
    resize(width, height) {
      state = { ...state, width, height };
    },
  };
}
