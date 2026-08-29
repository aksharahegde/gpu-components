/**
 * Normalizes `WheelEvent.deltaMode` (PLAN.md §9.5) — a mouse wheel typically reports `deltaMode: 1`
 * (DOM_DELTA_LINE) while a trackpad reports `deltaMode: 0` (DOM_DELTA_PIXEL), so raw `deltaY` values
 * are not comparable across input devices without this. `DOM_DELTA_PAGE` (2) is rare but handled for
 * completeness.
 */
export interface NormalizedWheel {
  readonly deltaX: number;
  readonly deltaY: number;
}

const LINE_HEIGHT_PX = 16;

export function normalizeWheel(e: WheelEvent, pageSize = { width: 800, height: 600 }): NormalizedWheel {
  switch (e.deltaMode) {
    case 1: // DOM_DELTA_LINE
      return { deltaX: e.deltaX * LINE_HEIGHT_PX, deltaY: e.deltaY * LINE_HEIGHT_PX };
    case 2: // DOM_DELTA_PAGE
      return { deltaX: e.deltaX * pageSize.width, deltaY: e.deltaY * pageSize.height };
    default: // DOM_DELTA_PIXEL
      return { deltaX: e.deltaX, deltaY: e.deltaY };
  }
}
