import type { Dataset } from "../types.ts";
import { PALETTE, oscillate, type MountResult, type RendererDef } from "./shared.ts";

/** Colour-bucketed `fillRect` — the "optimised fallback" path (PLAN.md §22), same approach as
 * `SpanBenchmark.tsx`: grouping by colour minimises `fillStyle` state changes, so the comparison
 * against WebGPU/WebGL2 is fair rather than flattering to the GPU side. */
export const canvas2dRenderer: RendererDef = {
  id: "canvas2d",

  async mount(container: HTMLElement, dataset: Dataset): Promise<MountResult> {
    const t0 = performance.now();
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("bench: 2d context unavailable");

    const buckets: Uint32Array[] = PALETTE.map(() => new Uint32Array(0));
    {
      const lists: number[][] = PALETTE.map(() => []);
      for (let i = 0; i < dataset.size; i++) lists[dataset.colorIndex[i]! % PALETTE.length]!.push(i);
      for (let b = 0; b < lists.length; b++) buckets[b] = Uint32Array.from(lists[b]!);
    }
    const uploadMs = performance.now() - t0;

    return {
      uploadMs,
      handle: {
        frame(now) {
          const { zoom, pan } = oscillate(now);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const W = container.clientWidth;
          const H = container.clientHeight;
          const pw = Math.round(W * dpr);
          const ph = Math.round(H * dpr);
          if (canvas.width !== pw || canvas.height !== ph) {
            canvas.width = pw;
            canvas.height = ph;
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = "#08090b";
          ctx.fillRect(0, 0, W, H);

          const rowH = H / dataset.trackCount;
          for (let b = 0; b < buckets.length; b++) {
            ctx.fillStyle = PALETTE[b]!;
            const idx = buckets[b]!;
            for (let j = 0; j < idx.length; j++) {
              const i = idx[j]!;
              const x = (dataset.start[i]! * zoom + pan) * W;
              let w = dataset.duration[i]! * zoom * W;
              if (w < 0.75) w = 0.75;
              if (x > W || x + w < 0) continue;
              ctx.fillRect(x, dataset.track[i]! * rowH + 4, w, 13);
            }
          }
        },
        unmount() {
          canvas.remove();
        },
      },
    };
  },
};
