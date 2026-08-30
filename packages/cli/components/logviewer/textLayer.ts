import { matchRanges, type LogLevel } from "./ingest.ts";

/**
 * The log's text layer: a Canvas2D surface drawn *over* the GPU canvas.
 *
 * The direct product of `spikes/log-text-budget.md`, and the second time this project has measured
 * the question and got the same answer. `GPUDataGrid` reached here first; the log viewer was picked
 * partly on the expectation that it would finally force a glyph atlas, and the measurement said no —
 * per-run Canvas2D text costs 0.1ms p50 at a realistic 60-line window, about 0.6% of a frame, with
 * no crossover anywhere in the sweep.
 *
 * What the GPU draws underneath: row backgrounds, level stripes, selection, and the minimap. What
 * this draws: glyphs, in coloured runs, with search matches boxed. The split is not arbitrary —
 * whole-line state is data the GPU already holds, and anything needing the characters themselves is
 * string work, which §5.2 keeps on the CPU.
 *
 * **The cost of this choice, stated where the code makes it:** canvas text is not selectable and not
 * copyable, and §21.2 makes selectable label text an accessibility requirement. `GPULogViewer.tsx`
 * answers that the way `GPUDataGrid.tsx` does — a real DOM node for the focused line plus a semantic
 * model — and this layer covers the other ~59 lines, which no assistive technology was going to read
 * one at a time anyway.
 */

export interface LogTextTheme {
  readonly font: string;
  readonly timestampColor: string;
  readonly loggerColor: string;
  readonly messageColor: string;
  readonly dimmedAlpha: number;
  readonly matchBackground: string;
  readonly matchColor: string;
  readonly levelColors: Readonly<Record<LogLevel, string>>;
  readonly paddingLeft: number;
}

export const DEFAULT_LOG_THEME: LogTextTheme = {
  font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
  timestampColor: "#6b7280",
  loggerColor: "#a78bfa",
  messageColor: "#d7dbe4",
  dimmedAlpha: 0.32,
  matchBackground: "#134e3a",
  matchColor: "#6ee7b7",
  levelColors: {
    trace: "#6b7280",
    debug: "#7590b3",
    info: "#60a5fa",
    warn: "#fbbf24",
    error: "#f87171",
  },
  paddingLeft: 10,
};

export interface VisibleLine {
  readonly logical: number;
  readonly text: string;
  readonly line: { readonly level: LogLevel; readonly logger: string; readonly message: string };
  readonly matched: boolean;
}

export interface DrawLogTextOptions {
  readonly ctx: CanvasRenderingContext2D;
  readonly lines: readonly VisibleLine[];
  readonly width: number;
  readonly height: number;
  readonly lineHeight: number;
  /** Sub-line scroll remainder, matching the shader's `scrollPx` exactly. */
  readonly scrollPx: number;
  readonly dpr: number;
  /** Highlighted when a query is active. */
  readonly queryText?: string;
  readonly caseSensitive?: boolean;
  readonly filtering?: boolean;
  readonly theme?: LogTextTheme;
}

/** Fixed advance for the monospace face, measured once per context rather than per line. */
function advanceOf(ctx: CanvasRenderingContext2D): number {
  return ctx.measureText("0").width;
}

/**
 * Draws the visible lines.
 *
 * Runs on scroll, data or query change — not on every frame — and the offsets it uses are the same
 * `firstVisible`/`scrollPx` decomposition the shader uses, which is what keeps the glyphs aligned to
 * the GPU rows underneath. If those two ever computed the scroll differently the text would drift
 * against its own background by a pixel at some offsets and not others.
 */
export function drawLogText(options: DrawLogTextOptions): void {
  const {
    ctx, lines, width, height, lineHeight, scrollPx, dpr,
    queryText = "", caseSensitive = false, filtering = false,
  } = options;
  const theme = options.theme ?? DEFAULT_LOG_THEME;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = theme.font;
  ctx.textBaseline = "middle";

  const advance = advanceOf(ctx);
  const baseX = theme.paddingLeft;

  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i]!;
    const y = i * lineHeight - scrollPx + lineHeight / 2;
    if (y < -lineHeight || y > height + lineHeight) continue;

    // Unmatched lines stay legible rather than disappearing: filtering here is emphasis, not a
    // filter, so the surrounding context a log reader needs is still on screen.
    ctx.globalAlpha = filtering && !entry.matched ? theme.dimmedAlpha : 1;

    const text = entry.text;
    // `formatLogLine` builds "<time>  <LEVEL>  <logger>  <message>" with two spaces between fields,
    // so the field boundaries are recoverable by position without re-parsing the string.
    const timeEnd = 12;
    const levelEnd = timeEnd + 2 + 5;
    const loggerEnd = levelEnd + 2 + entry.line.logger.length;

    const runs: readonly [number, number, string][] = [
      [0, timeEnd, theme.timestampColor],
      [timeEnd, levelEnd, theme.levelColors[entry.line.level]],
      [levelEnd, loggerEnd, theme.loggerColor],
      [loggerEnd, text.length, theme.messageColor],
    ];

    for (const [start, end, color] of runs) {
      if (start >= end) continue;
      ctx.fillStyle = color;
      ctx.fillText(text.slice(start, end), baseX + start * advance, y);
    }

    // Search matches, boxed and recoloured. Character ranges map to pixels by multiplication because
    // the face is monospace — the one place this component depends on that, and the reason it can
    // highlight inside a line without measuring text per match.
    if (queryText !== "" && entry.matched) {
      for (const [from, to] of matchRanges(text, queryText, caseSensitive)) {
        const x = baseX + from * advance;
        const w = (to - from) * advance;
        ctx.fillStyle = theme.matchBackground;
        ctx.fillRect(x - 1, y - lineHeight / 2 + 1, w + 2, lineHeight - 2);
        ctx.fillStyle = theme.matchColor;
        ctx.fillText(text.slice(from, to), x, y);
      }
    }
  }

  ctx.globalAlpha = 1;
}
