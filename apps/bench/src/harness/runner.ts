import type { Dataset, FrameStats, RunResult } from "../types.ts";
import type { RendererDef, RendererHandle } from "../renderers/shared.ts";

export interface RunOptions {
  readonly warmupFrames: number;
  readonly measuredFrames: number;
  readonly runs: number;
}

/** PLAN.md §20.1: 200 warmup frames discarded, ≥3 runs. `measuredFrames: 300` is this harness's
 * choice for a stable p99 without an unreasonable per-cell wall-clock cost. */
export const DEFAULT_OPTIONS: RunOptions = { warmupFrames: 200, measuredFrames: 300, runs: 3 };

/** PLAN.md §20.1: "dropped frames" = rAF delta > 1.5× the target interval. Target interval is
 * taken as 16.6ms (60Hz) regardless of the display's actual refresh rate — this is deliberately a
 * fixed reference point, not adaptive, so numbers are comparable across machines. */
const TARGET_FRAME_MS = 1000 / 60;
const DROPPED_THRESHOLD_MS = TARGET_FRAME_MS * 1.5;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

function computeStats(samples: readonly number[], dropped: number): FrameStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    worst: sorted[sorted.length - 1] ?? 0,
    droppedFrames: dropped,
    sampleCount: sorted.length,
  };
}

function measureOneRun(handle: RendererHandle, opts: RunOptions): Promise<FrameStats> {
  return new Promise((resolve) => {
    let frameIndex = 0;
    let last = performance.now();
    const samples: number[] = [];
    let dropped = 0;
    const total = opts.warmupFrames + opts.measuredFrames;

    function tick(now: number) {
      const dt = now - last;
      last = now;
      handle.frame(now);
      frameIndex++;
      if (frameIndex > opts.warmupFrames) {
        samples.push(dt);
        if (dt > DROPPED_THRESHOLD_MS) dropped++;
      }
      if (frameIndex >= total) {
        resolve(computeStats(samples, dropped));
      } else {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  });
}

/** Average each percentile across runs; `worst` and `droppedFrames` are the run-level max/sum, not
 * averaged, since those are exactly the numbers a single bad run shouldn't get smoothed away. */
function foldRuns(runs: readonly FrameStats[]): FrameStats {
  const avg = (f: (r: FrameStats) => number) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
  return {
    p50: avg((r) => r.p50),
    p95: avg((r) => r.p95),
    p99: avg((r) => r.p99),
    worst: Math.max(...runs.map((r) => r.worst)),
    droppedFrames: runs.reduce((s, r) => s + r.droppedFrames, 0),
    sampleCount: runs.reduce((s, r) => s + r.sampleCount, 0),
  };
}

export async function measureRenderer(
  def: RendererDef,
  container: HTMLElement,
  dataset: Dataset,
  opts: RunOptions = DEFAULT_OPTIONS,
): Promise<RunResult> {
  if (def.maxSpans != null && dataset.size > def.maxSpans) {
    return {
      renderer: def.id,
      shape: dataset.shape,
      size: dataset.size,
      stats: null,
      skippedReason: `${def.id} is capped at ${def.maxSpans.toLocaleString("en-US")} spans (see PLAN.md §20.3: "unusable above ~10k")`,
      uploadMs: null,
      runs: [],
    };
  }

  const runsStats: FrameStats[] = [];
  let uploadMs: number | null = null;
  for (let run = 0; run < opts.runs; run++) {
    const { handle, uploadMs: um } = await def.mount(container, dataset);
    if (run === 0) uploadMs = um;
    try {
      runsStats.push(await measureOneRun(handle, opts));
    } finally {
      handle.unmount();
    }
  }

  return {
    renderer: def.id,
    shape: dataset.shape,
    size: dataset.size,
    stats: foldRuns(runsStats),
    uploadMs,
    runs: runsStats,
  };
}
