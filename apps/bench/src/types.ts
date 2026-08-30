export type Shape = "shallow-wide" | "deep-nested" | "bursty";

export const SHAPES: readonly Shape[] = ["shallow-wide", "deep-nested", "bursty"];

export const SIZES: readonly number[] = [1_000, 10_000, 100_000, 1_000_000, 5_000_000, 10_000_000];

export type RendererId = "dom" | "canvas2d" | "webgl2" | "webgpu";

export const RENDERERS: readonly RendererId[] = ["dom", "canvas2d", "webgl2", "webgpu"];

/**
 * A generated benchmark dataset — columnar typed arrays (not `RawSpan[]`) so building 10M spans
 * doesn't allocate 10M short-lived objects. `start`/`duration` are in the normalized [0, 1] domain
 * the existing site's `SpanBenchmark` widget also uses, so a viewport transform is a single
 * multiply-add, not a per-span branch.
 */
export interface Dataset {
  readonly shape: Shape;
  readonly size: number;
  readonly trackCount: number;
  readonly start: Float64Array;
  readonly duration: Float64Array;
  readonly track: Uint16Array;
  readonly colorIndex: Uint8Array;
}

export interface FrameStats {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly worst: number;
  readonly droppedFrames: number;
  readonly sampleCount: number;
}

export interface RunResult {
  readonly renderer: RendererId;
  readonly shape: Shape;
  readonly size: number;
  /** `null` when this cell was intentionally skipped (see `renderers/*`'s `maxSpans`). */
  readonly stats: FrameStats | null;
  readonly skippedReason?: string;
  readonly uploadMs: number | null;
  /** One `FrameStats` per run, before being folded into `stats` — kept for variance reporting. */
  readonly runs: readonly FrameStats[];
}

export interface BenchReport {
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly results: readonly RunResult[];
}
