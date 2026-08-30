/**
 * `GPULogViewer`'s data model — PLAN.md §6.2 candidate #6 (119.5).
 *
 * The seventh component, and the first with a dataset that has a **tail**. Everything before it
 * uploads an immutable dataset: spans, a matrix, points, columns, nodes, two images. §5 gate 3 calls
 * that the ideal GPU case, and it is, but it had quietly become an assumption the runtime was never
 * tested against. A log stream appends forever, so this component is built on `core`'s new
 * `RingBuffer` and is the reason that primitive exists.
 *
 * **What is on the GPU and what is not**, decided by §5.2 rather than by enthusiasm:
 *
 * - *On the GPU*: one 8-byte record per line (timestamp + level), the match flags, row and level-
 *   stripe rendering, and the match-density reduction that drives the minimap. Scrolling is a
 *   uniform write over a buffer holding up to a million lines.
 * - *On the CPU*: the text itself, and all searching. §5.2 is unambiguous — "string handling of any
 *   kind… stays CPU/worker" — so matching runs once per query, not per frame, and produces flags the
 *   GPU consumes. There is no GPU string search here and the docs should not imply one.
 * - *Canvas2D*: the glyphs, per `spikes/log-text-budget.md`, which measured per-run Canvas2D text at
 *   0.1ms for a realistic window and found no crossover where a glyph atlas would win.
 */

/** Severity, ordered. The index is what the shader receives, so the order is load-bearing. */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export function levelIndex(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

export interface LogLine {
  /** Milliseconds since epoch. */
  readonly timestamp: number;
  readonly level: LogLevel;
  /** Emitter name — `auth.session`, `http.router`. Rendered dim, before the message. */
  readonly logger: string;
  readonly message: string;
}

/** Bytes per GPU record: `{ time: f32, level: u32 }`. A multiple of 4, as `RingBuffer` requires. */
export const LOG_RECORD_STRIDE = 8;

/**
 * Packs lines into the ring's record layout.
 *
 * `time` is seconds relative to `epochMs` rather than an absolute millisecond count, because f32
 * carries only ~24 bits of mantissa: absolute epoch milliseconds (~1.8e12) would quantise to steps
 * of about 131 seconds, which would make every timestamp in a session identical. Relative seconds
 * keep millisecond resolution for a run of several days.
 */
export function packLogRecords(lines: readonly LogLine[], epochMs: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(new ArrayBuffer(lines.length * LOG_RECORD_STRIDE));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    view.setFloat32(i * LOG_RECORD_STRIDE, (line.timestamp - epochMs) / 1000, true);
    view.setUint32(i * LOG_RECORD_STRIDE + 4, levelIndex(line.level), true);
  }
  return new Uint8Array(view.buffer);
}

/** Renders a line to the single string the text layer draws and assistive technology reads. */
export function formatLogLine(line: LogLine): string {
  const time = new Date(line.timestamp).toISOString().slice(11, 23);
  return `${time}  ${line.level.toUpperCase().padEnd(5)}  ${line.logger}  ${line.message}`;
}

export interface LogQuery {
  readonly text: string;
  readonly caseSensitive?: boolean;
  /** Levels to keep. Omitted or empty means every level. */
  readonly levels?: readonly LogLevel[];
}

/** True when `line` satisfies `query`. Plain substring matching — CPU-side, per §5.2. */
export function lineMatches(line: LogLine, query: LogQuery): boolean {
  if (query.levels && query.levels.length > 0 && !query.levels.includes(line.level)) return false;
  if (query.text === "") return true;
  const haystack = `${line.logger} ${line.message}`;
  return query.caseSensitive
    ? haystack.includes(query.text)
    : haystack.toLowerCase().includes(query.text.toLowerCase());
}

/**
 * Character ranges of `needle` within `haystack`, for the text layer's highlight.
 *
 * Deliberately CPU-side and deliberately only for the ~60 visible lines: highlighting inside a line
 * is a *text* operation, and the split this component draws is that whole-line state goes to the GPU
 * while anything needing the characters themselves stays here.
 */
export function matchRanges(haystack: string, needle: string, caseSensitive = false): readonly [number, number][] {
  if (needle === "") return [];
  const hay = caseSensitive ? haystack : haystack.toLowerCase();
  const find = caseSensitive ? needle : needle.toLowerCase();
  const ranges: [number, number][] = [];
  let at = hay.indexOf(find);
  while (at !== -1) {
    ranges.push([at, at + find.length]);
    at = hay.indexOf(find, at + find.length);
  }
  return ranges;
}

/** Deterministic sample data for demos and tests. */
export function generateLogLines(count: number, startMs: number, seed = 0x10c): LogLine[] {
  let state = seed >>> 0;
  const rnd = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const loggers = ["auth.session", "http.router", "db.pool", "cache.redis", "worker.queue", "gpu.device"];
  const messages: Record<LogLevel, string[]> = {
    trace: ["entering handler with 3 middlewares", "span opened for request lifecycle"],
    debug: ["cache miss for key user:8814:preferences", "resolved 12 routes in 0.4ms"],
    info: ["connection established to upstream replica", "listening on port 8080", "checkpoint written"],
    warn: ["pool saturated, 32 of 32 connections in use", "retrying after transient failure"],
    error: ["upstream timed out after 30000ms", "failed to acquire lock, giving up"],
  };
  // Weighted so errors are rare, which is what makes the minimap worth looking at — a uniform mix
  // would give it a flat profile and nothing to find.
  const weights: readonly LogLevel[] = [
    "trace", "debug", "debug", "info", "info", "info", "info", "info", "warn", "error",
  ];

  const lines: LogLine[] = [];
  let at = startMs;
  for (let i = 0; i < count; i++) {
    at += Math.floor(rnd() * 40);
    const level = weights[Math.floor(rnd() * weights.length)]!;
    const pool = messages[level];
    lines.push({
      timestamp: at,
      level,
      logger: loggers[Math.floor(rnd() * loggers.length)]!,
      message: `${pool[Math.floor(rnd() * pool.length)]!} (#${i})`,
    });
  }
  return lines;
}
