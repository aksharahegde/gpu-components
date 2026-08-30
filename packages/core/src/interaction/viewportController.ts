import { pixelXToTime, rowRange } from "../viewport.ts";
import type { ViewportState } from "../viewport.ts";

/** The data's own time range — pan/zoom never moves the viewport outside it (PLAN.md §9.5's
 * `viewport.ts` "clamping" responsibility; inertia is deferred). */
export interface ViewportBounds {
  readonly timeMin: number;
  readonly timeMax: number;
  /** Row bounds for the y axis. Omitted, the y axis is not clamped because it does not move —
   * the Timeline shows every track at once. `GPUHeatmap` supplies `[0, rows]`. */
  readonly rowMin?: number;
  readonly rowMax?: number;
}

export interface ViewportController {
  getState(): ViewportState;
  /** Zooms by `factor` (>1 zooms out, <1 zooms in), keeping the time value under `pixelX` fixed on
   * screen — the standard "zoom toward pointer" transform. */
  zoomAt(pixelX: number, factor: number): void;
  /**
   * The y-axis counterpart of `zoomAt`, keeping the row under `pixelY` fixed on screen.
   *
   * A separate method rather than extra parameters on `zoomAt`: the two axes are genuinely
   * independent (a heatmap zooms both, a timeline only x), and `zoomAt(px, f, py?, fy?)` would
   * make the common single-axis call read worse to serve the rarer one. A no-op when the viewport
   * has no explicit row range, so a Timeline calling it cannot accidentally start scrolling.
   */
  zoomAtY(pixelY: number, factor: number): void;
  /** Shifts the domain so that a screen-space drag tracks the pointer. `deltaY` moves the row
   * range and is ignored unless the viewport has one. */
  panByPixels(deltaX: number, deltaY?: number): void;
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

/**
 * Clamps the visible row range inside `[rowMin, rowMax]`, mirroring `clampSpan`'s x behaviour:
 * never wider than the bounds, never scrolled past either edge, never collapsed to nothing.
 * A viewport with no explicit row range is returned untouched — it does not scroll vertically.
 */
function clampRows(state: ViewportState, bounds: ViewportBounds): ViewportState {
  if (state.rowStart === undefined && state.rowEnd === undefined) return state;
  const min = bounds.rowMin ?? 0;
  const max = bounds.rowMax ?? state.trackCount;
  const boundsSpan = max - min || 1;

  let span = Math.min(Math.max((state.rowEnd ?? max) - (state.rowStart ?? min), MIN_ROW_SPAN), boundsSpan);
  let rowStart = state.rowStart ?? min;
  let rowEnd = rowStart + span;
  if (rowStart < min) {
    rowStart = min;
    rowEnd = rowStart + span;
  }
  if (rowEnd > max) {
    rowEnd = max;
    rowStart = rowEnd - span;
  }
  return { ...state, rowStart, rowEnd };
}

/** Never zoom in past a single row — below this the row-centre mapping stops being meaningful. */
const MIN_ROW_SPAN = 1;

export function createViewportController(
  initial: ViewportState,
  bounds: ViewportBounds,
): ViewportController {
  let state = clampRows(clampSpan(initial, bounds), bounds);

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
    zoomAtY(pixelY, factor) {
      if (state.rowStart === undefined && state.rowEnd === undefined) return;
      const [start, end] = rowRange(state);
      const targetRow = start + (pixelY / (state.height || 1)) * (end - start);
      const boundsSpan = (bounds.rowMax ?? state.trackCount) - (bounds.rowMin ?? 0) || 1;
      const newSpan = Math.min(Math.max((end - start) * factor, MIN_ROW_SPAN), boundsSpan);
      const fraction = pixelY / (state.height || 1);
      const rowStart = targetRow - fraction * newSpan;
      state = clampRows({ ...state, rowStart, rowEnd: rowStart + newSpan }, bounds);
    },
    panByPixels(deltaX, deltaY = 0) {
      const span = state.timeEnd - state.timeStart;
      const dt = (deltaX / (state.width || 1)) * span;
      let next: ViewportState = {
        ...state,
        timeStart: state.timeStart + dt,
        timeEnd: state.timeEnd + dt,
      };
      if (deltaY !== 0 && (state.rowStart !== undefined || state.rowEnd !== undefined)) {
        const [start, end] = rowRange(state);
        const dr = (deltaY / (state.height || 1)) * (end - start);
        next = { ...next, rowStart: start + dr, rowEnd: end + dr };
      }
      state = clampRows(clampSpan(next, bounds), bounds);
    },
    resize(width, height) {
      state = { ...state, width, height };
    },
  };
}
