import { GpuRuntime, type MountHandle } from "@gpuc/core";
import { ingestSpans, type RawSpan, type SpanBuffers } from "../../../../registry/timeline/ingest.ts";
import { TimelineComponent } from "../../../../registry/timeline/TimelineComponent.ts";
import { generateDataset } from "../generators.ts";
import { oscillate } from "../renderers/shared.ts";
import type { FrameStats } from "../types.ts";

/**
 * PLAN.md Phase 0 goal (a): "one device / many canvases / one submit works and is faster than N
 * devices." Phase 1's `GpuRuntime`/`FrameScheduler` already made this architectural choice and it's
 * unit-tested (`packages/core/src/scheduler.test.ts`), but nothing had actually compared it against
 * N independent devices — this does. The question is per-frame *scheduling/submit* overhead with
 * two mounted components, not rendering throughput, so both components are mounted empty (no span
 * data uploaded).
 *
 * **Root-cause fix (2026-08-30):** the first version of this scenario drove the measured frames
 * through `GpuRuntime.invalidate()`, which only marks *surfaces* dirty
 * (`packages/core/src/runtime.ts`) — the scheduler's active-component filter checks
 * `component.dirty || component.animating` (`packages/core/src/scheduler.ts`), neither of which
 * `invalidate()` touches. `TimelineComponent.dirty` starts `true`, goes `false` after its very
 * first `plan()`, and is never set again because `update()` is never called by this scenario. The
 * result: after frame 1 (buried in `WARMUP_FRAMES`), the scheduler's `active` list was empty for
 * every one of the 300 "measured" frames, in *both* configurations — `FrameScheduler.tick()` hit
 * its `if (active.length === 0) return;` early-out every time, so nothing was ever encoded or
 * submitted. The measured `p50 ≈ 16.7ms` in the first `BASELINES.md` run was not scheduling/submit
 * overhead at all — it was bare `requestAnimationFrame` cadence (the display's vsync interval),
 * which is architecture-agnostic by construction and explains why shared vs. independent tied.
 * Fixed by setting `animating = true` on each mounted component, which keeps it in the scheduler's
 * active set every tick — so every measured frame now genuinely dispatches `TimelineComponent`'s
 * compute pass and encodes+submits its render pass through the real `vgpu` `frame()`/`frameLoop()`
 * path, for both configurations, which is what this scenario was always meant to measure.
 *
 * **Component-count scaling, round 1 (2026-08-30):** the original scenario only ever compared 2
 * components, and `decision-record.md` said as much — "doesn't touch the actual 'many canvases'
 * ceiling." At 2 trivially-cheap *empty* components, per-frame work is far below the ~16.6ms vsync
 * floor either way, so a real scheduling/submit-overhead difference has no room to show up. Scaling
 * component count to 8 with the `animating`-only fix (still empty payload) didn't help either —
 * `dispatchCull()` returns early for a component with no uploaded spans, so even that "real" path
 * was doing near-zero GPU work: an indirect draw with a 0 instance count and a 16-byte buffer reset,
 * ×N. `decision-record.md`'s own full render matrix shows a *single* `TimelineComponent` stays under
 * the vsync floor even at 10M real spans — so the fixed per-device/per-submit overhead this scenario
 * is actually trying to isolate is the thing that needs to dominate, not GPU compute/render cost from
 * a bigger payload (a bigger payload dilutes that signal, it doesn't sharpen it).
 *
 * **Round 2 (2026-08-30): real (but small) payload, oscillating viewport, higher N.** Each component
 * now gets `PAYLOAD_SPANS` real spans (small — just enough that the compute-cull dispatch and
 * indirect draw do genuine non-zero work, not enough to make GPU compute cost dominate) and is
 * driven every measured frame through `component.update()` with an oscillating viewport (`oscillate`,
 * the same "always real work, never a cached repaint" trick `renderers/webgpu.ts` already uses) —
 * this both keeps the component genuinely dirty every tick (replacing the `animating` shortcut with
 * the same call pattern a real consumer uses) and forces a fresh viewport-uniform write + cull
 * dispatch + indirect draw every frame. `COMPONENT_COUNTS` now reaches higher, since the lever most
 * likely to expose *submission-count* overhead (the actual thing "one device, one submit" claims to
 * save) is more devices/submits per tick, not more data per device. Independent-device creation is
 * wrapped in try/catch per count — a browser's concurrent-`GPUDevice` cap is expected to be hit
 * eventually, and that should show up as a reported limit, not crash the whole scenario.
 */
export interface SharedContextRunResult {
  readonly componentCount: number;
  readonly sharedRuntime: FrameStats;
  readonly independentRuntimes: FrameStats | null;
  /** Set when `independentRuntimes` is `null` — e.g. a browser's concurrent-`GPUDevice` cap. */
  readonly independentSkippedReason?: string;
}
export type SharedContextResult = readonly SharedContextRunResult[];

/** Component counts to compare shared-vs-independent at. The independent-device configuration opens
 * `componentCount` separate `GPUDevice`s — expected to eventually hit a browser's concurrent-device
 * cap (PLAN.md §2(a)), which is reported (`independentSkippedReason`), not treated as a crash. */
const COMPONENT_COUNTS = [2, 8, 16, 24] as const;

/** Real spans per component — small enough that GPU compute/render cost doesn't dominate and drown
 * out per-device/per-submit overhead (see this file's "Round 2" doc comment above), but non-zero so
 * `TimelineComponent`'s cull-dispatch/indirect-draw path does genuine work instead of the degenerate
 * `spans.count === 0` early-out. */
const PAYLOAD_SPANS = 2_000;
const VIEWPORT_SIZE = { width: 300, height: 150 };

function toRawSpans(dataset: ReturnType<typeof generateDataset>): RawSpan[] {
  const spans: RawSpan[] = new Array(dataset.size);
  for (let i = 0; i < dataset.size; i++) {
    spans[i] = {
      start: dataset.start[i]!,
      duration: dataset.duration[i]!,
      track: dataset.track[i]!,
      colorIndex: dataset.colorIndex[i]!,
    };
  }
  return spans;
}

export function buildPayload(): { spans: SpanBuffers; trackCount: number } {
  const dataset = generateDataset("bursty", PAYLOAD_SPANS);
  return { spans: ingestSpans(toRawSpans(dataset)), trackCount: dataset.trackCount };
}

const MEASURED_FRAMES = 300;
const WARMUP_FRAMES = 50;

export function makeCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.width = "50%";
  canvas.style.height = "100%";
  canvas.style.display = "inline-block";
  container.appendChild(canvas);
  return canvas;
}

function measureFrames(advance: () => void, frames = MEASURED_FRAMES): Promise<FrameStats> {
  return new Promise((resolve) => {
    let i = 0;
    let last = performance.now();
    const samples: number[] = [];
    let dropped = 0;
    function tick(now: number) {
      const dt = now - last;
      last = now;
      advance();
      i++;
      if (i > WARMUP_FRAMES) {
        samples.push(dt);
        if (dt > (1000 / 60) * 1.5) dropped++;
      }
      if (i >= WARMUP_FRAMES + frames) {
        const sorted = [...samples].sort((a, b) => a - b);
        const pct = (p: number) =>
          sorted[Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1)))] ?? 0;
        resolve({
          p50: pct(50),
          p95: pct(95),
          p99: pct(99),
          worst: sorted[sorted.length - 1] ?? 0,
          droppedFrames: dropped,
          sampleCount: sorted.length,
        });
      } else {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  });
}

function viewportForPhase(now: number): { timeStart: number; timeEnd: number } {
  const { zoom, pan } = oscillate(now);
  return { timeStart: -pan / zoom, timeEnd: (1 - pan) / zoom };
}

/** Uploads `payload.spans` into every mounted component and returns a per-frame `advance` closure
 * that re-`update()`s each with a fresh (oscillating) viewport — real work every tick, the same
 * pattern `renderers/webgpu.ts` uses, which also keeps `dirty` genuinely true without the
 * `animating` shortcut this file used before real payload existed. */
export function driveComponents(
  components: readonly TimelineComponent[],
  payload: { spans: SpanBuffers; trackCount: number },
  invalidateAll: () => void,
): () => void {
  const initial = { ...VIEWPORT_SIZE, trackCount: payload.trackCount, timeStart: 0, timeEnd: 1 };
  for (const c of components) c.update({ spans: payload.spans, viewport: initial });
  return () => {
    const { timeStart, timeEnd } = viewportForPhase(performance.now());
    const viewport = { ...VIEWPORT_SIZE, trackCount: payload.trackCount, timeStart, timeEnd };
    for (const c of components) c.update({ spans: payload.spans, viewport });
    invalidateAll();
  };
}

async function measureSharedRuntime(
  container: HTMLElement,
  componentCount: number,
  payload: { spans: SpanBuffers; trackCount: number },
): Promise<FrameStats> {
  const runtime = await GpuRuntime.create();
  const canvases = Array.from({ length: componentCount }, () => makeCanvas(container));
  const components: TimelineComponent[] = [];
  const handles: MountHandle[] = canvases.map((canvas) =>
    runtime.mount(() => {
      const c = new TimelineComponent(payload.spans.count);
      components.push(c);
      return c;
    }, canvas),
  );
  try {
    const advance = driveComponents(components, payload, () => runtime.invalidate());
    return await measureFrames(advance);
  } finally {
    for (const h of handles) h.unmount();
    runtime.dispose();
    for (const canvas of canvases) canvas.remove();
  }
}

/** Returns `null` (with a reason) instead of throwing when `componentCount` independent
 * `GPUDevice`s can't all be created — a browser's concurrent-device cap is an expected outcome at
 * high `N`, not a scenario failure (see this file's "Round 2" doc comment). */
async function measureIndependentRuntimes(
  container: HTMLElement,
  componentCount: number,
  payload: { spans: SpanBuffers; trackCount: number },
): Promise<{ stats: FrameStats; skippedReason?: undefined } | { stats: null; skippedReason: string }> {
  let runtimes: GpuRuntime[];
  try {
    runtimes = await Promise.all(Array.from({ length: componentCount }, () => GpuRuntime.create()));
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
    return { stats: await measureFrames(advance) };
  } finally {
    for (const h of handles) h.unmount();
    for (const runtime of runtimes) runtime.dispose();
    for (const canvas of canvases) canvas.remove();
  }
}

export async function runSharedContextScenario(container: HTMLElement): Promise<SharedContextResult> {
  const payload = buildPayload();
  const results: SharedContextRunResult[] = [];
  for (const componentCount of COMPONENT_COUNTS) {
    const sharedRuntime = await measureSharedRuntime(container, componentCount, payload);
    const independent = await measureIndependentRuntimes(container, componentCount, payload);
    results.push({
      componentCount,
      sharedRuntime,
      independentRuntimes: independent.stats,
      independentSkippedReason: independent.skippedReason,
    });
    // A concurrent-device cap at this count will only get worse at the next (higher) count too —
    // stop scaling rather than spend the rest of the matrix re-discovering the same limit.
    if (!independent.stats) break;
  }
  return results;
}
