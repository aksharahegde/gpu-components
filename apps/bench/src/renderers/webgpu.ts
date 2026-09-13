import { GpuRuntime } from "@gpuc/core";
// Imported from the concrete files, not the barrel `index.ts` — that barrel also re-exports the
// React-based `GPUTimeline.tsx`, and this package has no `react` dependency.
import { ingestSpans, type RawSpan } from "../../../../registry/timeline/ingest.ts";
import { TimelineComponent } from "../../../../registry/timeline/TimelineComponent.ts";
import type { Dataset } from "../types.ts";
import { oscillate, type MountResult, type RendererDef } from "./shared.ts";

function toRawSpans(dataset: Dataset): RawSpan[] {
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

/**
 * Drives the real `TimelineComponent` (`registry/timeline`) directly via `GpuRuntime`, no React —
 * this is the actual `@gpuc/react` consumer minus the React adapter layer, so the
 * benchmark measures the runtime everyone else would get, not a synthetic stand-in.
 */
export const webgpuRenderer: RendererDef = {
  id: "webgpu",

  async mount(container: HTMLElement, dataset: Dataset): Promise<MountResult> {
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    const runtime = await GpuRuntime.create();
    if (!runtime.caps.webgpu) {
      canvas.remove();
      throw new Error("bench: WebGPU unavailable in this browser/context");
    }

    const t0 = performance.now();
    const spanBuffers = ingestSpans(toRawSpans(dataset));
    let component: TimelineComponent | null = null;
    const handleRef = runtime.mount((_ctx) => {
      component = new TimelineComponent(dataset.size);
      return component;
    }, canvas);

    const viewport = () => ({
      timeStart: 0,
      timeEnd: 1,
      trackCount: dataset.trackCount,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    component!.update({ spans: spanBuffers, viewport: viewport() });
    // `component.update` only uploads; force the submit that actually lands the data on the GPU
    // before stopping the upload timer (`invalidate` wakes the scheduler for the next tick).
    runtime.invalidate();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const uploadMs = performance.now() - t0;

    return {
      uploadMs,
      handle: {
        frame(now) {
          const { zoom, pan } = oscillate(now);
          const timeStart = -pan / zoom;
          const timeEnd = (1 - pan) / zoom;
          component!.update({
            spans: spanBuffers,
            viewport: { ...viewport(), timeStart, timeEnd },
          });
          runtime.invalidate();
        },
        unmount() {
          handleRef.unmount();
          runtime.dispose();
          canvas.remove();
        },
      },
    };
  },
};
