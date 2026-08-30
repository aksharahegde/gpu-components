import type { FramePass } from "vgpu";
import type { ViewportUniforms } from "./viewport.ts";

/**
 * What a `RenderPass.encode()` draws into (PLAN.md §22.2).
 *
 * Until this existed, `encode()` took `vgpu`'s `FramePass` directly, which quietly made §22.2's
 * central claim — "because the `RenderPlan` primitives are small and declarative, one Canvas2D
 * backend serves every component" — untrue: the plan was declarative about *passes*, but the draws
 * inside them were an opaque callback into vgpu that nothing else could interpret.
 *
 * Making the target a tagged union fixes that **without touching a single component**: components
 * draw through the core primitives (`layer.draw(pass)`), and it is the *primitive* that knows both
 * backends. That is the whole point — one Canvas2D backend, not a second renderer per component,
 * which is the maintenance trap PLAN.md §4.1 criticises `chartcn` for walking into.
 */
export type PassEncoder = GpuPassEncoder | Canvas2DPassEncoder;

export interface GpuPassEncoder {
  readonly kind: "gpu";
  /** The `vgpu` pass the scheduler opened. Escape hatch for a component that genuinely needs a raw
   * vgpu draw — using it means that draw has no fallback, which is a documented choice, not a bug. */
  readonly frame: FramePass;
}

/**
 * The degraded path (PLAN.md §22.2). Carries the numeric viewport rather than a bound uniform
 * object, because a Canvas2D backend has no uniforms — the same scale/offset values the shaders
 * read from `viewportUniforms()`, so both paths transform coordinates identically by construction.
 */
export interface Canvas2DPassEncoder {
  readonly kind: "canvas2d";
  readonly ctx: CanvasRenderingContext2D;
  /** CSS pixels. The context is expected to be pre-scaled for DPR by whoever opened the pass. */
  readonly width: number;
  readonly height: number;
  readonly viewport: ViewportUniforms;
  /**
   * Called when a primitive draws less than it was asked to (PLAN.md §22.2: above the cap the
   * fallback "downsamples the data and says so"). The runtime forwards this to the application's
   * `onPerformance({ degraded: true, reason })`. A fallback that silently truncated would be
   * exactly the "silent fallback" anti-pattern §17.3 forbids.
   */
  report(reason: string): void;
}

/** Wraps a `vgpu` frame pass as the GPU encoder. */
export function gpuPass(frame: FramePass): GpuPassEncoder {
  return { kind: "gpu", frame };
}

/** Per-primitive Canvas2D budgets from PLAN.md §22.2's table. Exceeding one downsamples and
 * reports; it never silently truncates. */
export const CANVAS2D_CAPS = {
  quads: 50_000,
  lineSegments: 20_000,
} as const;

/**
 * Even stride sampling for a set that exceeds its cap: `n` items reduced to at most `cap`, spread
 * across the whole range rather than truncated to the first `cap`. Truncation would silently drop
 * everything past a point on screen; sampling degrades density uniformly, which is both honest and
 * more useful to look at.
 */
export function samplingStride(count: number, cap: number): number {
  if (count <= cap || cap <= 0) return 1;
  return Math.ceil(count / cap);
}

/** `#rrggbb`/`rgba()` string for a packed `0xRRGGBBAA` colour — the format `packRgba8()` produces
 * and `LINE_WGSL` unpacks, so both backends read one source of truth for colour. */
export function cssColor(packed: number): string {
  const value = packed >>> 0;
  const r = (value >>> 24) & 255;
  const g = (value >>> 16) & 255;
  const b = (value >>> 8) & 255;
  const a = value & 255;
  return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/** Clip-space [-1, 1] to CSS pixels. Clip y is +1 at the top (matching `trackToClipScaleOffset`'s
 * "track 0 at the top"), so the y conversion flips. */
export function clipToPixelX(clipX: number, width: number): number {
  return ((clipX + 1) / 2) * width;
}

export function clipToPixelY(clipY: number, height: number): number {
  return ((1 - clipY) / 2) * height;
}
