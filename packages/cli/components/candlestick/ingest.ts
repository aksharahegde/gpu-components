/**
 * `GPUCandlestick`'s data model — PLAN.md §6.2 candidate #7 (119.0).
 *
 * **Why this component, given the plan ranks it eighth.** It is the acceptance test for `RingBuffer`.
 * That primitive shipped with `GPULogViewer` and has exactly one consumer, which means its eviction
 * policy, its wrap splitting and its `slotOf` contract were all designed while looking at log lines.
 * A primitive with one consumer may simply be that consumer's internals in a different file. §29
 * applied this test to `core` itself — could it host a component it was not designed around — and
 * the heatmap found two real gaps. Nothing had run that test on the ring.
 *
 * **What this component honestly claims, and what it does not.** A candlestick chart shows a few
 * hundred visible bars. That is nothing for any renderer, and §8.1's warning about leading with a
 * weak performance claim applies here exactly as it does to the grid. So:
 *
 * - *Genuinely GPU*: streaming appends into a resident ring; pan and zoom as uniform writes over an
 *   immutable buffer (§5 gate 3); and the overview strip's bucketed min/max/volume reduction across
 *   **every** bar in the history, which is the question a CPU cannot answer on the main thread.
 * - *Deliberately CPU*: the visible price range that auto-scales the y-axis. It is a min/max over the
 *   ~300 bars on screen, and §5.2 is explicit that small-N work belongs on the CPU. Dispatching a
 *   compute pass for 300 numbers would be theatre.
 */

/** Bytes per GPU record: six f32 — time, open, high, low, close, volume. */
export const BAR_STRIDE = 24;

export interface Bar {
  /** Milliseconds since epoch, for the crosshair readout. Bars are *positioned* by ordinal, not by
   * time, so that gaps (weekends, halts) do not open holes in the chart — the convention every
   * trading chart follows. */
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface Tick {
  readonly time: number;
  readonly price: number;
  readonly size: number;
}

/**
 * Packs bars into the ring's record layout.
 *
 * Time is stored relative to `epochMs` in seconds for the same reason `GPULogViewer` does it: f32
 * carries ~24 bits of mantissa, so absolute epoch milliseconds quantise to ~131-second steps and
 * every bar in a session would collapse onto the same timestamp.
 */
export function packBars(bars: readonly Bar[], epochMs: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(new ArrayBuffer(bars.length * BAR_STRIDE));
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const at = i * BAR_STRIDE;
    view.setFloat32(at, (bar.time - epochMs) / 1000, true);
    view.setFloat32(at + 4, bar.open, true);
    view.setFloat32(at + 8, bar.high, true);
    view.setFloat32(at + 12, bar.low, true);
    view.setFloat32(at + 16, bar.close, true);
    view.setFloat32(at + 20, bar.volume, true);
  }
  return new Uint8Array(view.buffer);
}

/**
 * Rejects bars the overview reduction cannot handle.
 *
 * The reduction uses `atomicMin`/`atomicMax` on the raw bit pattern of the price, which is only
 * order-preserving for **positive** floats — the sign bit inverts the ordering, so a negative price
 * would compare as larger than every positive one and silently corrupt the envelope. Instruments
 * with negative prices exist (a famous April 2020 oil contract), so this is a real constraint and it
 * is checked at ingest rather than left to produce a wrong-looking chart.
 */
export function validateBars(bars: readonly Bar[]): void {
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    if (!(bar.low > 0)) {
      throw new RangeError(
        `gpu-components/candlestick: prices must be positive (bar ${i} has low=${bar.low}). ` +
          `The overview reduction compares float bit patterns, which only orders positive values.`,
      );
    }
    if (bar.high < bar.low) {
      throw new RangeError(`gpu-components/candlestick: bar ${i} has high ${bar.high} below low ${bar.low}`);
    }
  }
}

/** Min and max over a slice of bars — the visible y-range, computed on the CPU on purpose. */
export function priceRange(bars: readonly Bar[], from: number, to: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = Math.max(0, from); i < Math.min(bars.length, to); i++) {
    const bar = bars[i]!;
    if (bar.low < min) min = bar.low;
    if (bar.high > max) max = bar.high;
  }
  if (min === Infinity) return { min: 0, max: 1 };
  // A flat range would divide by zero in the viewport transform; give it a hair of height.
  if (max - min < 1e-9) return { min: min - 0.5, max: max + 0.5 };
  return { min, max };
}

/**
 * Folds ticks into the bar they belong to, extending the last bar or starting a new one.
 *
 * String-free and allocation-light, and on the CPU because it is inherently serial — each tick
 * depends on which bar is currently open. Returns the bars that *changed* so a caller can decide
 * between appending and rewriting the last record.
 */
export function aggregateTicks(
  bars: Bar[],
  ticks: readonly Tick[],
  intervalMs: number,
): { appended: number; updatedLast: boolean } {
  let appended = 0;
  let updatedLast = false;

  for (const tick of ticks) {
    const bucket = Math.floor(tick.time / intervalMs) * intervalMs;
    const last = bars[bars.length - 1];
    if (last && last.time === bucket) {
      bars[bars.length - 1] = {
        time: last.time,
        open: last.open,
        high: Math.max(last.high, tick.price),
        low: Math.min(last.low, tick.price),
        close: tick.price,
        volume: last.volume + tick.size,
      };
      updatedLast = true;
    } else {
      bars.push({
        time: bucket,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.size,
      });
      appended++;
    }
  }
  return { appended, updatedLast };
}

/** Deterministic sample series — a random walk with drift and occasional volatility clusters. */
export function generateBars(count: number, startMs: number, startPrice = 180, seed = 0xca7): Bar[] {
  let state = seed >>> 0;
  const rnd = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const bars: Bar[] = [];
  let price = startPrice;
  let volatility = 0.006;
  for (let i = 0; i < count; i++) {
    // Volatility clusters: real series are not homoscedastic, and a chart of pure white noise makes
    // the overview strip look uniform and therefore useless.
    if (rnd() < 0.02) volatility = 0.003 + rnd() * 0.02;
    // Mean-zero, with gentle reversion toward the starting level. A small positive drift compounds
    // over a long series — at 200,000 bars the first version reached a price of 2.9 million, which
    // is not wrong so much as useless to look at.
    const reversion = (startPrice - price) / startPrice * 0.002;
    const drift = (rnd() - 0.5) * volatility + reversion;
    const open = price;
    const close = Math.max(0.01, open * (1 + drift));
    const wick = Math.abs(drift) * (0.4 + rnd());
    bars.push({
      time: startMs + i * 60_000,
      open,
      high: Math.max(open, close) * (1 + wick),
      low: Math.max(0.01, Math.min(open, close) * (1 - wick)),
      close,
      volume: Math.round(1000 + rnd() * 9000 + Math.abs(drift) * 400_000),
    });
    price = close;
  }
  return bars;
}
