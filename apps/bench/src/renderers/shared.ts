import type { Dataset, RendererId } from "../types.ts";

/**
 * Slow zoom/pan oscillation so every measured frame does genuine transform + redraw work, never a
 * cached repaint — same trick as `apps/site/src/components/SpanBenchmark.tsx`. Small amplitude; the
 * whole dataset stays on screen (this is the plan's "zoomed-out, every span redrawn" scenario).
 */
export function oscillate(now: number): { zoom: number; pan: number } {
  const phase = now / 3600;
  return { zoom: 1 + Math.sin(phase) * 0.06, pan: Math.sin(phase * 0.7) * 0.02 };
}

export const PALETTE = ["#8b9dff", "#5be9b9", "#f0b072", "#f08a8a", "#7fd8f0", "#b7a4ff"] as const;

export interface RendererHandle {
  /** Advance and redraw one measured frame. Must perform real work every call — see `oscillate`. */
  frame(now: number): void;
  unmount(): void;
}

export interface MountResult {
  readonly handle: RendererHandle;
  /** Wall-clock ms spent building/uploading this renderer's initial GPU/DOM state for `dataset`. */
  readonly uploadMs: number;
}

export interface RendererDef {
  readonly id: RendererId;
  /**
   * Spans above this size are skipped, not measured. DOM is documented (site + PLAN.md §20.3) as
   * "unusable above ~10k" — running it to 10M would just hang a tab for no signal.
   */
  readonly maxSpans?: number;
  mount(container: HTMLElement, dataset: Dataset): Promise<MountResult>;
}
