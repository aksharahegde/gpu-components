import { GpuRuntime } from "@gpuc/core";
import { TimelineComponent } from "../../../../registry/timeline/TimelineComponent.ts";
import { buildPayload, driveComponents, makeCanvas } from "./sharedContextScenario.ts";

/**
 * Round 3 of the shared-vs-independent-device investigation (`decision-record.md`). Rounds 1-2
 * established that `requestAnimationFrame`-interval measurement has a hard floor at the display's
 * vsync rate and cannot show a sub-vsync scheduling/submit-overhead difference no matter how much
 * payload or how many devices — the conclusion was "build the Phase 4 `Profiler` (real `timer(gpu)`
 * GPU timing) before attempting this measurement again." That `Profiler` now exists
 * (`packages/core/src/profiler.ts`) — this scenario uses it directly: real per-pass GPU
 * milliseconds, decoded 1-2 frames after submit, summed across every mounted component's passes and
 * averaged over a measurement window. No vsync floor to hide behind.
 *
 * Reuses `sharedContextScenario.ts`'s `buildPayload`/`driveComponents`/`makeCanvas` — same payload,
 * same "always real work" oscillating-viewport drive pattern, so this is genuinely the same
 * workload measured a different way, not a new one.
 */
export interface GpuTimingRunResult {
  readonly componentCount: number;
  readonly shared: GpuTimingStats;
  readonly independent: GpuTimingStats | null;
  readonly independentSkippedReason?: string;
}
export type GpuTimingResult = readonly GpuTimingRunResult[];

export interface GpuTimingStats {
  /** Mean total real GPU ms per tick — summed across every mounted component's per-pass GPU time,
   * not wall-clock time between rAF callbacks. For `shared`, this is one device's per-frame
   * `onGpuResults` sum, averaged over however many results arrived; for `independent`, it's the sum
   * across *all* devices' `onGpuResults` callbacks, averaged over the driving loop's own wall-clock
   * tick count — so the two are directly comparable as "total GPU cost per wall-clock tick," even
   * though the two denominators come from different counters (see each measure function's comment). */
  readonly avgFrameGpuMs: number;
  /** The denominator `avgFrameGpuMs` was divided by. `vgpu`'s docs note a lagging readback ring can
   * drop a frame's result *whole*, so a low count reads as "less confident," not hidden. */
  readonly sampleCount: number;
}

const COMPONENT_COUNTS = [2, 8, 16, 24] as const;
/** Wall-clock measurement window per configuration — long enough for GPU timing's 1-2 frame
 * readback latency to settle and for a real average to form, short enough that the whole scenario
 * (2 configurations x N counts) finishes in a reasonable CI budget. */
const MEASURE_MS = 1500;
const WARMUP_MS = 300;

function driveFor(advance: () => void, totalMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    function step() {
      advance();
      if (performance.now() - start < totalMs) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

async function measureSharedGpuTiming(
  container: HTMLElement,
  componentCount: number,
  payload: ReturnType<typeof buildPayload>,
): Promise<GpuTimingStats> {
  const runtime = await GpuRuntime.create({ profiling: true });
  const canvases = Array.from({ length: componentCount }, () => makeCanvas(container));
  const components: TimelineComponent[] = [];
  const handles = canvases.map((canvas) =>
    runtime.mount(() => {
      const c = new TimelineComponent(payload.spans.count);
      components.push(c);
      return c;
    }, canvas),
  );
  try {
    const advance = driveComponents(components, payload, () => runtime.invalidate());
    // Warm up: let pipelines compile and the readback ring fill before sampling.
    await driveFor(advance, WARMUP_MS);

    let sumMs = 0;
    let sampleCount = 0;
    const unsub = runtime.profiler.onGpuResults((spans) => {
      for (const key in spans) sumMs += spans[key]!;
      sampleCount++;
    });
    await driveFor(advance, MEASURE_MS);
    unsub();

    return { avgFrameGpuMs: sampleCount > 0 ? sumMs / sampleCount : NaN, sampleCount };
  } finally {
    for (const h of handles) h.unmount();
    runtime.dispose();
    for (const canvas of canvases) canvas.remove();
  }
}

/** Same aggregation idea as `sharedContextScenario.ts`'s independent-device path: `N` separate
 * `GpuRuntime`s, each with its own `Profiler` (real GPU timing is per-device — `timer(gpu)` wraps
 * one specific device's queries). Every device's `onGpuResults` callback adds into one shared
 * running total; `sampleCount` is the driving loop's own tick count (not the number of
 * `onGpuResults` calls, which would be ~`componentCount`x that) — matching the "total real GPU cost
 * summed across every device, per wall-clock tick" metric `measureSharedGpuTiming` reports, so the
 * two are directly comparable. */
async function measureIndependentGpuTiming(
  container: HTMLElement,
  componentCount: number,
  payload: ReturnType<typeof buildPayload>,
): Promise<{ stats: GpuTimingStats; skippedReason?: undefined } | { stats: null; skippedReason: string }> {
  let runtimes: GpuRuntime[];
  try {
    runtimes = await Promise.all(
      Array.from({ length: componentCount }, () => GpuRuntime.create({ profiling: true })),
    );
  } catch (err) {
    return { stats: null, skippedReason: err instanceof Error ? err.message : String(err) };
  }

  const canvases = Array.from({ length: componentCount }, () => makeCanvas(container));
  const components: TimelineComponent[] = [];
  const handles = runtimes.map((runtime, i) =>
    runtime.mount(() => {
      const c = new TimelineComponent(payload.spans.count);
      components.push(c);
      return c;
    }, canvases[i]!),
  );
  try {
    const advance = driveComponents(components, payload, () => {
      for (const runtime of runtimes) runtime.invalidate();
    });
    await driveFor(advance, WARMUP_MS);

    let sumMs = 0;
    const unsubs = runtimes.map((runtime) =>
      runtime.profiler.onGpuResults((spans) => {
        for (const key in spans) sumMs += spans[key]!;
      }),
    );
    let wallTicks = 0;
    await driveFor(() => {
      advance();
      wallTicks++;
    }, MEASURE_MS);
    for (const unsub of unsubs) unsub();

    return { stats: { avgFrameGpuMs: wallTicks > 0 ? sumMs / wallTicks : NaN, sampleCount: wallTicks } };
  } finally {
    for (const h of handles) h.unmount();
    for (const runtime of runtimes) runtime.dispose();
    for (const canvas of canvases) canvas.remove();
  }
}

export async function runGpuTimingScenario(container: HTMLElement): Promise<GpuTimingResult> {
  const payload = buildPayload();
  const results: GpuTimingRunResult[] = [];
  for (const componentCount of COMPONENT_COUNTS) {
    const shared = await measureSharedGpuTiming(container, componentCount, payload);
    const independent = await measureIndependentGpuTiming(container, componentCount, payload);
    results.push({
      componentCount,
      shared,
      independent: independent.stats,
      independentSkippedReason: independent.skippedReason,
    });
    if (!independent.stats) break;
  }
  return results;
}
