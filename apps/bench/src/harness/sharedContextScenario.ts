import { GpuRuntime, type MountHandle } from "@gpu-components/core";
import { TimelineComponent } from "../../../../registry/timeline/TimelineComponent.ts";
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
 * **Component-count scaling (2026-08-30):** the original scenario only ever compared 2 components,
 * and `decision-record.md` said as much — "doesn't touch the actual 'many canvases' ceiling." At 2
 * trivially-cheap components, per-frame work is far below the ~16.6ms vsync floor either way, so a
 * real scheduling/submit-overhead difference (one encoder+submit vs. two) has no room to show up —
 * both configurations tie at the floor regardless of which architecture is actually cheaper. This
 * now runs at several component counts (`COMPONENT_COUNTS`) so a real difference has a chance to
 * emerge once total per-tick work approaches the frame budget.
 */
export interface SharedContextRunResult {
  readonly componentCount: number;
  readonly sharedRuntime: FrameStats;
  readonly independentRuntimes: FrameStats;
}
export type SharedContextResult = readonly SharedContextRunResult[];

/** Component counts to compare shared-vs-independent at. Kept modest — each independent-runtime
 * measurement opens `componentCount` separate `GPUDevice`s, and browsers cap concurrent devices
 * (PLAN.md §2(a)). */
const COMPONENT_COUNTS = [2, 4, 8] as const;

const MEASURED_FRAMES = 300;
const WARMUP_FRAMES = 50;

function makeCanvas(container: HTMLElement): HTMLCanvasElement {
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

/** Marks a just-mounted component perpetually active so the scheduler's `dirty || animating` filter
 * (`packages/core/src/scheduler.ts`) keeps it in the active set every tick — see this file's own doc
 * comment for why `invalidate()` alone doesn't do that. */
function keepAnimating(component: TimelineComponent): TimelineComponent {
  component.animating = true;
  return component;
}

async function measureSharedRuntime(container: HTMLElement, componentCount: number): Promise<FrameStats> {
  const runtime = await GpuRuntime.create();
  const canvases = Array.from({ length: componentCount }, () => makeCanvas(container));
  const handles: MountHandle[] = canvases.map((canvas) =>
    runtime.mount(() => keepAnimating(new TimelineComponent(1)), canvas),
  );
  try {
    return await measureFrames(() => runtime.invalidate());
  } finally {
    for (const h of handles) h.unmount();
    runtime.dispose();
    for (const canvas of canvases) canvas.remove();
  }
}

async function measureIndependentRuntimes(container: HTMLElement, componentCount: number): Promise<FrameStats> {
  const runtimes = await Promise.all(Array.from({ length: componentCount }, () => GpuRuntime.create()));
  const canvases = Array.from({ length: componentCount }, () => makeCanvas(container));
  const handles = runtimes.map((runtime, i) =>
    runtime.mount(() => keepAnimating(new TimelineComponent(1)), canvases[i]!),
  );
  try {
    return await measureFrames(() => {
      for (const runtime of runtimes) runtime.invalidate();
    });
  } finally {
    for (const h of handles) h.unmount();
    for (const runtime of runtimes) runtime.dispose();
    for (const canvas of canvases) canvas.remove();
  }
}

export async function runSharedContextScenario(container: HTMLElement): Promise<SharedContextResult> {
  const results: SharedContextRunResult[] = [];
  for (const componentCount of COMPONENT_COUNTS) {
    const sharedRuntime = await measureSharedRuntime(container, componentCount);
    const independentRuntimes = await measureIndependentRuntimes(container, componentCount);
    results.push({ componentCount, sharedRuntime, independentRuntimes });
  }
  return results;
}
