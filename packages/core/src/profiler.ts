import { timer, type Gpu, type Timer, type TimerSpan } from "vgpu";

/** One tick's CPU-side stats (PLAN.md §28.1's "Draw calls, dispatches, passes — Yes — our counters
 * — Scheduler instrumentation" row). Free to collect — `performance.now()` bracketing and plain
 * counters, no device feature required — so these are always populated, independent of `enabled`. */
export interface FrameStats {
  readonly cpuMs: number;
  readonly componentCount: number;
  readonly passCount: number;
  readonly dispatchCount: number;
}

/**
 * PLAN.md §10.7 / §28: the real GPU-timing + frame-stats surface `scheduler.ts`'s own doc comment
 * already promised ("the profiler attaches a `timer.span(name)` per pass") before this existed.
 * `enabled` reflects only the GPU-side half (`timestamp-query`, 1-2 frames of readback latency,
 * PLAN.md §28.1's table) — CPU frame stats (`recordFrame`/`lastFrame`) work regardless, since
 * they cost nothing to collect.
 */
export interface Profiler {
  readonly enabled: boolean;
  /** Wraps `Timer.span(name)` when `enabled`; `undefined` otherwise — a valid, inert
   * `FramePassOptions.timer` value, not an error. */
  span(name: string): TimerSpan | undefined;
  /** Mirrors `Timer.onResults` — one frozen `name → ms` record per timed frame, 1-2 frames after
   * submit. A no-op subscription (never fires) when `!enabled`. */
  onGpuResults(cb: (spans: Readonly<Record<string, number>>) => void): () => void;
  /** Called once per `FrameScheduler.tick()` that did real work — internal wiring, exposed so a
   * custom scheduler or a test can drive it directly. */
  recordFrame(stats: FrameStats): void;
  readonly lastFrame: FrameStats | null;
  dispose(): void;
}

/** For when there is no `Gpu` at all (`caps.webgpu === false`) — not the same as "GPU timing off but
 * a real Gpu exists," which still tracks CPU frame stats via `createProfiler(gpu, false)`. */
export const DISABLED_PROFILER: Profiler = {
  enabled: false,
  span: () => undefined,
  onGpuResults: () => () => {},
  recordFrame: () => {},
  lastFrame: null,
  dispose: () => {},
};

/**
 * `gpuTimingEnabled` should already reflect `caps.timestampQuery && options.profiling` — this
 * function does not re-check capability support; `timer(gpu)` itself throws `VGPU-TIMER-INVALID`
 * if asked for on a device that never actually got the `"timestamp-query"` feature (`vgpu`'s own
 * docs), so callers must gate correctly before calling this with `true`.
 */
export function createProfiler(gpu: Gpu, gpuTimingEnabled: boolean): Profiler {
  const gpuTimer: Timer | null = gpuTimingEnabled ? timer(gpu) : null;
  let lastFrame: FrameStats | null = null;

  return {
    enabled: gpuTimer !== null,
    span: (name) => gpuTimer?.span(name),
    onGpuResults: (cb) => gpuTimer?.onResults(cb) ?? (() => {}),
    recordFrame: (stats) => {
      lastFrame = stats;
    },
    get lastFrame() {
      return lastFrame;
    },
    dispose: () => gpuTimer?.dispose(),
  };
}
