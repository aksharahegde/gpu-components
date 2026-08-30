/**
 * The log-viewer text spike (PLAN.md §12.1's fourth primitive, §30 risk 2).
 *
 * **The question this exists to answer:** does `GPULogViewer` justify building a GPU glyph atlas,
 * when `spikes/grid-text-budget.md` already found that `GPUDataGrid` did not?
 *
 * That earlier result is the reason this scenario is not a formality. The grid measured 2,400 short
 * cells and Canvas2D won outright — 2.9ms p50 with zero dropped frames. A log line drawn as a single
 * `fillText` is *cheaper still*: 60 lines is 60 calls, a fortieth of the grid's call count. If the
 * question were "how many `fillText` calls", the answer would already be "no atlas needed", and
 * building one anyway would repeat exactly the mistake §8.1 warns about.
 *
 * So the honest question is narrower, and it is what this measures: **a log viewer does not draw one
 * string per line.** It draws a timestamp, a level, a logger name, a message, and highlighted search
 * matches — each in a different colour, which forces a separate `fillText` run per token because a
 * 2D context carries one `fillStyle` at a time. And it draws all of them again on every frame of a
 * scroll, because when every line moves there is no damage region to exploit. Run count per frame is
 * therefore lines x runs-per-line, not lines, and it grows with the window.
 *
 * The sweep goes past a comfortable window on purpose. **60 lines is the row to read as real** — a
 * 900px window at 15px lines. 120 and 240 are stress points rather than window sizes (240 lines at
 * this line height is a 3,600px surface, which nobody has), included so that a crossover would be
 * visible if one existed at all. It does not.
 *
 * **Methodology is inherited deliberately** from `textBudgetScenario.ts`: CPU milliseconds per frame
 * via `performance.now()` brackets, never rAF intervals. `results/decision-record.md` rounds 1-3
 * established that rAF-interval measurement has a hard floor at the display's vsync rate and cannot
 * resolve differences below ~16.6ms. Dropped frames are reported as a secondary signal.
 */

export type LogTextStrategy = "canvas2d-line" | "canvas2d-runs" | "atlas-packing";

export interface LogTextRun {
  readonly strategy: LogTextStrategy;
  /** Visible lines in the window. */
  readonly lines: number;
  /** Glyphs actually drawn per frame — the figure comparable across strategies. */
  readonly glyphs: number;
  /** `fillText` calls per frame; 0 for the atlas path, which issues none. */
  readonly textCalls: number;
  readonly cpuMs: { readonly p50: number; readonly p95: number; readonly p99: number; readonly worst: number };
  readonly droppedFrames: number;
  readonly sampleCount: number;
}

export type LogTextResult = readonly LogTextRun[];

const VIEWPORT_W = 1400;
/**
 * A realistic log window: 900px at 15px lines holds 60 lines, and 60 is the point in the sweep to
 * read as "a real user's screen".
 *
 * The canvas itself is sized to `lines * LINE_H` rather than fixed, because the first run of this
 * spike fixed it at 900px and the 240-line row came back *cheaper per glyph than the 60-line row*.
 * That was Chromium cheaply rejecting `fillText` calls whose baseline fell outside the canvas: three
 * quarters of the work at the top of the sweep was never done. A benchmark that silently stops doing
 * the work it claims to measure is worse than no benchmark, so the surface now grows with the sweep.
 */
const VIEWPORT_H = 900;
/** 12px monospace: ~7.2px advance, so ~190 columns across 1400px. Realistic for a log window. */
const CHAR_W = 7.2;
const LINE_H = 15;

/** Lines to sweep. 60 is the realistic window; 120 and 240 are stress points — see the header. */
const LINE_COUNTS = [30, 60, 120, 240] as const;

const WARMUP_FRAMES = 60;
const MEASURED_FRAMES = 180;
const TARGET_FRAME_MS = 1000 / 60;
const DROPPED_THRESHOLD_MS = TARGET_FRAME_MS * 1.5;

/** Bytes per glyph instance: x, y, u, v, size, colour — 6 x f32. Matches the grid spike's stride so
 * the two packing numbers are directly comparable. */
const GLYPH_STRIDE = 24;

const LEVELS = ["INFO ", "WARN ", "ERROR", "DEBUG"] as const;
const LOGGERS = ["auth.session", "http.router", "db.pool", "cache.redis", "worker.queue"] as const;
const MESSAGES = [
  "connection established to upstream replica in 42ms",
  "retrying request after transient failure, attempt 2 of 5",
  "cache miss for key user:8814:preferences, falling through",
  "slow query detected: SELECT * FROM events WHERE ts > $1",
  "pool saturated, 32 of 32 connections checked out",
] as const;

/**
 * One log line, split into the coloured runs a viewer actually draws.
 *
 * Content varies with the line's absolute index so scrolling brings genuinely different text into
 * view — a strategy that only wins on repeated strings would be answering the wrong question, the
 * same trap the grid spike avoided by regenerating cell text every frame.
 */
interface Run {
  readonly text: string;
  readonly color: string;
}
function logLine(absoluteLine: number): readonly Run[] {
  const level = LEVELS[absoluteLine % LEVELS.length]!;
  const message = MESSAGES[absoluteLine % MESSAGES.length]!;
  const runs: Run[] = [
    { text: `2026-08-30T14:${String(absoluteLine % 60).padStart(2, "0")}:${String((absoluteLine * 7) % 60).padStart(2, "0")}.${String(absoluteLine % 1000).padStart(3, "0")}Z`, color: "#6b7280" },
    { text: level, color: level === "ERROR" ? "#f87171" : level === "WARN " ? "#fbbf24" : "#60a5fa" },
    { text: LOGGERS[absoluteLine % LOGGERS.length]!, color: "#a78bfa" },
    { text: message, color: "#d7dbe4" },
  ];
  // A search match highlighted inside the message — the case that forces a run split mid-token, and
  // the reason a log viewer cannot collapse a line into one styled string.
  if (absoluteLine % 3 === 0) {
    runs.push({ text: " [matched]", color: "#34d399" });
  }
  return runs;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

interface Strategy {
  frame(frameIndex: number): void;
  teardown(): void;
  /** Counted on a single representative frame, not timed. */
  census(): { glyphs: number; textCalls: number };
}

function makeCanvas(host: HTMLElement, lines: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = VIEWPORT_W;
  // Tall enough that every swept line has somewhere to land — see VIEWPORT_H's note.
  canvas.height = Math.max(VIEWPORT_H, lines * LINE_H);
  canvas.style.cssText = "position:absolute;inset:0";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("bench: no 2d context for the log-text spike");
  ctx.font = "12px ui-monospace, monospace";
  ctx.textBaseline = "top";
  return ctx;
}

/**
 * The cheapest thing Canvas2D can do: one `fillText` per line, whole line in one colour.
 *
 * Included as the floor, and as the honest counter-argument to building an atlas at all. If a log
 * viewer never needed per-token colour this is what it would cost, and the atlas would lose badly.
 */
function canvas2dLineStrategy(host: HTMLElement, lines: number): Strategy {
  const ctx = makeCanvas(host, lines);
  return {
    frame(frameIndex) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = "#d7dbe4";
      for (let i = 0; i < lines; i++) {
        const absolute = frameIndex + i;
        const text = logLine(absolute).map((r) => r.text).join(" ");
        ctx.fillText(text, 0, i * LINE_H);
      }
    },
    teardown() {
      ctx.canvas.remove();
    },
    census() {
      let glyphs = 0;
      for (let i = 0; i < lines; i++) {
        glyphs += logLine(i).reduce((n, r) => n + r.text.length + 1, 0);
      }
      return { glyphs, textCalls: lines };
    },
  };
}

/**
 * What a real log viewer costs on Canvas2D: one `fillText` per coloured run.
 *
 * A 2D context holds a single `fillStyle`, so every colour change is another call. This is the
 * number the atlas has to beat — not the one-call-per-line floor above.
 */
function canvas2dRunsStrategy(host: HTMLElement, lines: number): Strategy {
  const ctx = makeCanvas(host, lines);
  return {
    frame(frameIndex) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      for (let i = 0; i < lines; i++) {
        const absolute = frameIndex + i;
        const y = i * LINE_H;
        let x = 0;
        for (const run of logLine(absolute)) {
          ctx.fillStyle = run.color;
          ctx.fillText(run.text, x, y);
          x += (run.text.length + 1) * CHAR_W;
        }
      }
    },
    teardown() {
      ctx.canvas.remove();
    },
    census() {
      let glyphs = 0;
      let calls = 0;
      for (let i = 0; i < lines; i++) {
        const runs = logLine(i);
        calls += runs.length;
        glyphs += runs.reduce((n, r) => n + r.text.length + 1, 0);
      }
      return { glyphs, textCalls: calls };
    },
  };
}

/**
 * The CPU half of a glyph-atlas path: pack one instance per glyph, every frame.
 *
 * As in the grid spike, this **excludes the GPU draw** and is therefore a floor rather than a total.
 * That exclusion is defensible for the same reason it was there: `results/BASELINES.md` has the
 * Timeline drawing millions of instanced quads per frame, so the draw is not where the cost is. The
 * unknown is the per-glyph packing and atlas lookup, and that is what this times.
 *
 * A monospace atlas is what makes this cheap: the advance is constant, so a glyph's position is
 * arithmetic on its column index. No measurement, no shaping, no kerning table.
 */
function atlasPackingStrategy(_host: HTMLElement, lines: number): Strategy {
  // Generous ceiling: 200 columns per line, so the buffer never reallocates mid-measurement.
  const capacity = lines * 200;
  const buffer = new ArrayBuffer(capacity * GLYPH_STRIDE);
  const view = new DataView(buffer);

  // The glyph -> UV map a real atlas carries. Latin-1 supplement included, per the chosen scope:
  // ASCII 0x20-0x7E plus 0xA0-0xFF, ~190 glyphs in a 16-wide grid.
  const atlas = new Map<number, { u: number; v: number }>();
  let slot = 0;
  for (let c = 0x20; c <= 0x7e; c++, slot++) atlas.set(c, { u: (slot % 16) / 16, v: ((slot / 16) | 0) / 16 });
  for (let c = 0xa0; c <= 0xff; c++, slot++) atlas.set(c, { u: (slot % 16) / 16, v: ((slot / 16) | 0) / 16 });

  // Colours resolve to a packed integer once per run, not once per glyph — a real implementation
  // would carry a small palette and store an index, so per-glyph colour parsing is not the cost.
  const palette = new Map<string, number>();
  const colorOf = (css: string): number => {
    let packed = palette.get(css);
    if (packed === undefined) {
      packed = parseInt(css.slice(1), 16) << 8 | 0xff;
      palette.set(css, packed);
    }
    return packed;
  };

  return {
    frame(frameIndex) {
      let g = 0;
      for (let i = 0; i < lines; i++) {
        const absolute = frameIndex + i;
        const y = i * LINE_H;
        let column = 0;
        for (const run of logLine(absolute)) {
          const color = colorOf(run.color);
          for (let ch = 0; ch < run.text.length && g < capacity; ch++, column++) {
            const uv = atlas.get(run.text.charCodeAt(ch)) ?? { u: 0, v: 0 };
            const at = g * GLYPH_STRIDE;
            // Fixed advance: x is column * CHAR_W, no measurement call anywhere in this loop.
            view.setFloat32(at + 0, column * CHAR_W, true);
            view.setFloat32(at + 4, y, true);
            view.setFloat32(at + 8, uv.u, true);
            view.setFloat32(at + 12, uv.v, true);
            view.setFloat32(at + 16, 12, true);
            view.setUint32(at + 20, color, true);
            g++;
          }
          column++;
        }
      }
    },
    teardown() {},
    census() {
      let glyphs = 0;
      for (let i = 0; i < lines; i++) {
        glyphs += logLine(i).reduce((n, r) => n + r.text.length + 1, 0);
      }
      return { glyphs, textCalls: 0 };
    },
  };
}

const STRATEGIES: Record<LogTextStrategy, (host: HTMLElement, lines: number) => Strategy> = {
  "canvas2d-line": canvas2dLineStrategy,
  "canvas2d-runs": canvas2dRunsStrategy,
  "atlas-packing": atlasPackingStrategy,
};

function measure(strategy: LogTextStrategy, host: HTMLElement, lines: number): Promise<LogTextRun> {
  const impl = STRATEGIES[strategy](host, lines);
  const { glyphs, textCalls } = impl.census();
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
          lines,
          glyphs,
          textCalls,
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

export async function runLogTextScenario(stage: HTMLElement): Promise<LogTextResult> {
  const host = document.createElement("div");
  host.style.cssText = `position:relative;width:${VIEWPORT_W}px;height:${VIEWPORT_H}px;background:#0b0d11`;
  stage.appendChild(host);

  const results: LogTextRun[] = [];
  for (const lines of LINE_COUNTS) {
    for (const strategy of ["canvas2d-line", "canvas2d-runs", "atlas-packing"] as const) {
      results.push(await measure(strategy, host, lines));
    }
  }

  host.remove();
  return results;
}
