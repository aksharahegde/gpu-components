import { GpuRuntime, type MountHandle } from "@gpu-components/core";
import { TimelineComponent } from "../../../../registry/timeline/TimelineComponent.ts";
import type { FrameStats } from "../types.ts";

/**
 * PLAN.md Phase 0 goal (a): "one device / many canvases / one submit works and is faster than N
 * devices." Phase 1's `GpuRuntime`/`FrameScheduler` already made this architectural choice and it's
 * unit-tested (`packages/core/src/scheduler.test.ts`), but nothing had actually compared it against
 * N independent devices — this does. The question is per-frame *scheduling/submit* overhead with
 * two mounted components, not rendering throughput, so both components are mounted empty (no span
 * data uploaded) and the measurement is purely `invalidate()` → scheduled frame → submit.
 */
export interface SharedContextResult {
  readonly sharedRuntime: FrameStats;
  readonly independentRuntimes: FrameStats;
}

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

async function measureSharedRuntime(container: HTMLElement): Promise<FrameStats> {
  const runtime = await GpuRuntime.create();
  const canvasA = makeCanvas(container);
  const canvasB = makeCanvas(container);
  const handles: MountHandle[] = [
    runtime.mount(() => new TimelineComponent(1), canvasA),
    runtime.mount(() => new TimelineComponent(1), canvasB),
  ];
  try {
    return await measureFrames(() => runtime.invalidate());
  } finally {
    for (const h of handles) h.unmount();
    runtime.dispose();
    canvasA.remove();
    canvasB.remove();
  }
}

async function measureIndependentRuntimes(container: HTMLElement): Promise<FrameStats> {
  const runtimeA = await GpuRuntime.create();
  const runtimeB = await GpuRuntime.create();
  const canvasA = makeCanvas(container);
  const canvasB = makeCanvas(container);
  const handleA = runtimeA.mount(() => new TimelineComponent(1), canvasA);
  const handleB = runtimeB.mount(() => new TimelineComponent(1), canvasB);
  try {
    return await measureFrames(() => {
      runtimeA.invalidate();
      runtimeB.invalidate();
    });
  } finally {
    handleA.unmount();
    handleB.unmount();
    runtimeA.dispose();
    runtimeB.dispose();
    canvasA.remove();
    canvasB.remove();
  }
}

export async function runSharedContextScenario(container: HTMLElement): Promise<SharedContextResult> {
  const sharedRuntime = await measureSharedRuntime(container);
  const independentRuntimes = await measureIndependentRuntimes(container);
  return { sharedRuntime, independentRuntimes };
}
