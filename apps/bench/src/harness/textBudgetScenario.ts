/**
 * The grid text spike (PLAN.md §13.4, §8.1, §30 risk 2).
 *
 * **The question this exists to answer:** does `GPUDataGrid` actually need a GPU glyph atlas?
 *
 * §13.4 budgets the DOM label overlay at ~400 labels and reaches for an atlas at ~50k glyphs. A
 * grid viewport is roughly 40 columns x 60 rows = 2,400 text cells — 6x the DOM budget but 20x
 * *under* the atlas threshold, and squarely in the range where glide-data-grid already sustains
 * 60fps on Canvas2D `fillText` (§4.3 calls that "the honest bar"). Nobody has measured where our
 * own crossover is, and building a glyph atlas is the single largest schedule risk in the phase.
 * So: measure first, exactly as §20 did for the Timeline before any renderer code was written.
 *
 * **Methodology note, learned the hard way.** This measures *CPU milliseconds of work per frame*
 * with `performance.now()` brackets, not `requestAnimationFrame` intervals. The shared-vs-
 * independent-device investigation (`results/decision-record.md`, rounds 1-3) established that rAF
 * interval measurement has a hard floor at the display's vsync rate and cannot resolve any
 * difference below ~16.6ms. All three strategies here are CPU-bound — DOM reconciliation, canvas
 * text rasterisation, instance packing — so the work itself is the thing to time. Dropped frames
 * are still reported as a secondary signal for when the work exceeds a frame budget.
 */

export type TextStrategy = "dom" | "canvas2d" | "atlas-packing";

export interface TextBudgetRun {
  readonly strategy: TextStrategy;
  readonly cells: number;
  /** Milliseconds of CPU work per frame, over `sampleCount` measured frames. */
  readonly cpuMs: { readonly p50: number; readonly p95: number; readonly p99: number; readonly worst: number };
  /** rAF deltas over 1.5x 16.6ms — secondary, and floor-limited as described above. */
  readonly droppedFrames: number;
  readonly sampleCount: number;
}

export type TextBudgetResult = readonly TextBudgetRun[];

/** Grid-shaped viewport. 40 x 60 = 2,400 cells is the §8.1 reference figure. */
const VIEWPORT_W = 1200;
const VIEWPORT_H = 700;
const COLS = 40;
const CELL_W = VIEWPORT_W / COLS;
const CELL_H = 18;

/** Cell counts to sweep, bracketing the 2,400 reference on both sides so the crossover is visible
 * rather than inferred from a single point. */
const CELL_COUNTS = [600, 1200, 2400, 4800] as const;

const WARMUP_FRAMES = 60;
const MEASURED_FRAMES = 180;
const TARGET_FRAME_MS = 1000 / 60;
const DROPPED_THRESHOLD_MS = TARGET_FRAME_MS * 1.5;

/** Average glyphs per cell. Grid cells hold short values — ids, numbers, short labels — so 8 is a
 * deliberately generous figure for the atlas path's per-glyph instance count. */
const GLYPHS_PER_CELL = 8;
/** Bytes per glyph instance in the packing proxy: x, y, u, v, size, colour — 6 x f32. */
const GLYPH_STRIDE = 24;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

/** Text that changes every frame — a scrolling grid never re-renders identical content, and a
 * strategy that only wins on unchanged text would be measuring the wrong thing. */
function cellText(index: number, frame: number): string {
  return `${((index * 7919 + frame * 13) % 100000).toString().padStart(5, "0")}`;
}

interface Strategy {
  /** Per-frame work. Everything inside is timed. */
  frame(frameIndex: number): void;
  teardown(): void;
}

/** Absolutely-positioned pooled `<span>`s — §13.4's v1 approach, scaled up to grid counts. */
function domStrategy(host: HTMLElement, cells: number): Strategy {
  const layer = document.createElement("div");
  layer.style.cssText = `position:absolute;inset:0;overflow:hidden;font:12px monospace;color:#ccc`;
  host.appendChild(layer);

  const nodes: HTMLSpanElement[] = [];
  for (let i = 0; i < cells; i++) {
    const span = document.createElement("span");
    span.style.cssText = "position:absolute;left:0;top:0;will-change:transform";
    layer.appendChild(span);
    nodes.push(span);
  }

  return {
    frame(frameIndex) {
      // Scroll offset shifts every cell, so transforms are rewritten as well as text — the real
      // per-frame cost of a scrolling grid, not a static one.
      const scrollY = (frameIndex % 60) * 0.5;
      for (let i = 0; i < cells; i++) {
        const col = i % COLS;
        const row = (i / COLS) | 0;
        const node = nodes[i]!;
        node.textContent = cellText(i, frameIndex);
        node.style.transform = `translate(${col * CELL_W}px, ${row * CELL_H - scrollY}px)`;
      }
    },
    teardown() {
      layer.remove();
    },
  };
}

/** A 2D canvas text layer over the GPU surface — what glide-data-grid does, and the option that
 * would let the grid ship with no glyph atlas at all. */
function canvas2dStrategy(host: HTMLElement, cells: number): Strategy {
  const canvas = document.createElement("canvas");
  canvas.width = VIEWPORT_W;
  canvas.height = VIEWPORT_H;
  canvas.style.cssText = "position:absolute;inset:0";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("bench: no 2d context for the text-budget spike");
  ctx.font = "12px monospace";
  ctx.textBaseline = "top";

  return {
    frame(frameIndex) {
      const scrollY = (frameIndex % 60) * 0.5;
      ctx.clearRect(0, 0, VIEWPORT_W, VIEWPORT_H);
      ctx.fillStyle = "#ccc";
      for (let i = 0; i < cells; i++) {
        const col = i % COLS;
        const row = (i / COLS) | 0;
        ctx.fillText(cellText(i, frameIndex), col * CELL_W, row * CELL_H - scrollY);
      }
    },
    teardown() {
      canvas.remove();
    },
  };
}

/**
 * The CPU half of a glyph-atlas path: build the per-glyph instance buffer every frame.
 *
 * This deliberately does **not** include the GPU draw, and the result must not be read as "the
 * atlas costs this much". The draw cost is already known to be negligible — `results/BASELINES.md`
 * has the Timeline drawing millions of instanced quads per frame — so the interesting unknown is
 * the CPU-side packing and glyph lookup that an atlas *adds* relative to the other two strategies.
 * What this measures is a floor, and it is labelled as one everywhere it is reported.
 */
function atlasPackingStrategy(_host: HTMLElement, cells: number): Strategy {
  const glyphs = cells * GLYPHS_PER_CELL;
  const buffer = new ArrayBuffer(glyphs * GLYPH_STRIDE);
  const view = new DataView(buffer);
  // A stand-in for the atlas's glyph->UV map: the lookup a real implementation does per glyph.
  const atlas = new Map<number, { u: number; v: number }>();
  for (let c = 32; c < 127; c++) atlas.set(c, { u: (c % 16) / 16, v: ((c / 16) | 0) / 8 });

  return {
    frame(frameIndex) {
      const scrollY = (frameIndex % 60) * 0.5;
      let g = 0;
      for (let i = 0; i < cells; i++) {
        const col = i % COLS;
        const row = (i / COLS) | 0;
        const text = cellText(i, frameIndex);
        const baseX = col * CELL_W;
        const baseY = row * CELL_H - scrollY;
        for (let ch = 0; ch < text.length && g < glyphs; ch++) {
          const uv = atlas.get(text.charCodeAt(ch)) ?? { u: 0, v: 0 };
          const at = g * GLYPH_STRIDE;
          view.setFloat32(at + 0, baseX + ch * 7, true);
          view.setFloat32(at + 4, baseY, true);
          view.setFloat32(at + 8, uv.u, true);
          view.setFloat32(at + 12, uv.v, true);
          view.setFloat32(at + 16, 12, true);
          view.setFloat32(at + 20, 0xccccccff, true);
          g++;
        }
      }
    },
    teardown() {},
  };
}

const STRATEGIES: Record<TextStrategy, (host: HTMLElement, cells: number) => Strategy> = {
  dom: domStrategy,
  canvas2d: canvas2dStrategy,
  "atlas-packing": atlasPackingStrategy,
};

function measure(strategy: TextStrategy, host: HTMLElement, cells: number): Promise<TextBudgetRun> {
  const impl = STRATEGIES[strategy](host, cells);
  return new Promise((resolve) => {
    const work: number[] = [];
    let dropped = 0;
    let frameIndex = 0;
    let last = performance.now();

    function tick(now: number) {
      const delta = now - last;
      last = now;

      const t0 = performance.now();
      impl.frame(frameIndex);
      const t1 = performance.now();

      frameIndex++;
      if (frameIndex > WARMUP_FRAMES) {
        work.push(t1 - t0);
        if (delta > DROPPED_THRESHOLD_MS) dropped++;
      }

      if (frameIndex >= WARMUP_FRAMES + MEASURED_FRAMES) {
        impl.teardown();
        const sorted = [...work].sort((a, b) => a - b);
        resolve({
          strategy,
          cells,
          cpuMs: {
            p50: percentile(sorted, 50),
            p95: percentile(sorted, 95),
            p99: percentile(sorted, 99),
            worst: sorted[sorted.length - 1] ?? 0,
          },
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

export async function runTextBudgetScenario(stage: HTMLElement): Promise<TextBudgetResult> {
  const host = document.createElement("div");
  host.style.cssText = `position:relative;width:${VIEWPORT_W}px;height:${VIEWPORT_H}px;background:#0b0d11`;
  stage.appendChild(host);

  const results: TextBudgetRun[] = [];
  for (const cells of CELL_COUNTS) {
    for (const strategy of ["dom", "canvas2d", "atlas-packing"] as const) {
      results.push(await measure(strategy, host, cells));
    }
  }

  host.remove();
  return results;
}
