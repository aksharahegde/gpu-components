import { pixelXToTime, pixelYToTrack } from "../viewport.ts";
import type { ViewportState } from "../viewport.ts";

/**
 * An axis-aligned brush region in data space (time range × track range) — PLAN.md §9.5's "brush /
 * lasso selection," scoped to a rectangle: a Timeline is a 2D grid (discrete track rows × continuous
 * time), not a scatter plot, so a rectangle is the natural, sufficient shape (see
 * `GPUTimeline.tsx`'s doc comment for the full scope note). `trackMin`/`trackMax` are inclusive,
 * integer track indices.
 */
export interface BrushRect {
  readonly timeStart: number;
  readonly timeEnd: number;
  readonly trackMin: number;
  readonly trackMax: number;
}

/**
 * Pure geometry — no gesture state machine here (that lives in the component driving the drag, same
 * split `inertia.ts` established for inertial pan: `core` gets DOM-independent math, the caller owns
 * pointer-event refs). Converts two CSS-pixel corners (in either order — a real drag can go in any
 * direction) into a normalized `BrushRect`, using the same `pixelXToTime`/`pixelYToTrack` transforms
 * the rest of `core`'s viewport math already uses, so a brush rectangle is always pixel-consistent
 * with everything else drawn from `viewport`.
 */
export function brushRectFromPixels(
  viewport: ViewportState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): BrushRect {
  const t0 = pixelXToTime(viewport, x0);
  const t1 = pixelXToTime(viewport, x1);
  const track0 = Math.round(pixelYToTrack(viewport, y0));
  const track1 = Math.round(pixelYToTrack(viewport, y1));
  const maxTrack = Math.max(0, viewport.trackCount - 1);

  return {
    timeStart: Math.min(t0, t1),
    timeEnd: Math.max(t0, t1),
    trackMin: Math.max(0, Math.min(track0, track1, maxTrack)),
    trackMax: Math.max(0, Math.min(Math.max(track0, track1), maxTrack)),
  };
}
