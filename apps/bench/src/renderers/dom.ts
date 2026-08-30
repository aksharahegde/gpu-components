import type { Dataset } from "../types.ts";
import { PALETTE, oscillate, type MountResult, type RendererDef } from "./shared.ts";

/** Absolutely-positioned pooled `<div>`s, matching `SpanBenchmark.tsx`'s DOM path. Capped — see
 * `RendererDef.maxSpans` below; DOM is not meant to survive the full size matrix. */
export const domRenderer: RendererDef = {
  id: "dom",
  maxSpans: 20_000,

  async mount(container: HTMLElement, dataset: Dataset): Promise<MountResult> {
    const t0 = performance.now();
    const layer = document.createElement("div");
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.overflow = "hidden";
    container.appendChild(layer);

    const frag = document.createDocumentFragment();
    const pool: HTMLDivElement[] = new Array(dataset.size);
    for (let i = 0; i < dataset.size; i++) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.height = "13px";
      el.style.borderRadius = "2px";
      el.style.willChange = "transform";
      el.style.background = PALETTE[dataset.colorIndex[i]! % PALETTE.length]!;
      pool[i] = el;
      frag.appendChild(el);
    }
    layer.appendChild(frag);
    const uploadMs = performance.now() - t0;

    const rowH = () => container.clientHeight / dataset.trackCount;
    const W = () => container.clientWidth;

    return {
      uploadMs,
      handle: {
        frame(now) {
          const { zoom, pan } = oscillate(now);
          const w = W();
          const rh = rowH();
          for (let i = 0; i < pool.length; i++) {
            const x = (dataset.start[i]! * zoom + pan) * w;
            let width = dataset.duration[i]! * zoom * w;
            if (width < 0.75) width = 0.75;
            const el = pool[i]!;
            if (x > w || x + width < 0) {
              if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
              continue;
            }
            if (el.style.visibility === "hidden") el.style.visibility = "";
            el.style.transform = `translate(${x.toFixed(1)}px, ${(dataset.track[i]! * rh + 4).toFixed(1)}px)`;
            el.style.width = `${width.toFixed(1)}px`;
          }
        },
        unmount() {
          layer.remove();
        },
      },
    };
  },
};
