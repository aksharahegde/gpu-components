import { RingBuffer } from "@gpuc/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  RenderPlan,
  RuntimeHandle,
  ViewportState,
} from "@gpuc/core";
import { compute, draw, storage, uniforms } from "vgpu";
import type { Compute, Draw, SharedUniforms, StorageBuffer } from "vgpu";
import { BAR_STRIDE, packBars, priceRange, validateBars, type Bar } from "./ingest.ts";
import {
  CANDLE_WGSL,
  OVERVIEW_BUCKETS,
  OVERVIEW_DRAW_WGSL,
  OVERVIEW_WGSL,
  OVERVIEW_WORKGROUP_SIZE,
} from "./candlestick.wgsl.ts";

/**
 * A growing series the component pulls from — the same shape `GPULogViewer` established, with one
 * addition the log did not need.
 *
 * `openBar` says the newest record is still being revised. A log line is history the moment it is
 * written; a candlestick's current bar is not, and every tick changes it. The component uses this to
 * choose between `RingBuffer.append` and `RingBuffer.overwrite`.
 */
export interface BarSource {
  readonly bars: readonly Bar[];
  readonly version: number;
  /** True when the last bar is still open and may change. */
  readonly openBar?: boolean;
}

export interface CandlestickProps {
  readonly source: BarSource;
  readonly viewport: ViewportState;
  /** Pixels panned from the oldest bar. */
  readonly scrollLeftPx?: number;
  /** Horizontal pixels per bar. Zoom is a change to this, and nothing else. */
  readonly pitchPx?: number;
  readonly follow?: boolean;
  readonly hoveredBar?: number | null;
  readonly overviewHeightPx?: number;
}

export interface OverviewReading {
  readonly lowest: number;
  readonly highest: number;
  readonly peakVolume: number;
  readonly buckets: Uint32Array;
}

const DEFAULT_PITCH = 8;
const DEFAULT_CAPACITY = 500_000;
const DEFAULT_OVERVIEW_H = 46;
/** Reserved so the overview strip is not drawn over by candles. */
const BODY_RATIO = 0.7;

let nextId = 0;

/**
 * `GPUCandlestick` — an OHLC chart over a streaming ring.
 *
 * **Built as the acceptance test for `core`'s `RingBuffer`**, which until now had exactly one
 * consumer and was therefore unproven: a primitive shaped by a single caller may just be that
 * caller's internals in another file. §29 ran this test on `core` with the heatmap and found two
 * genuine gaps. This run found one — see `RingBuffer.overwrite`, which exists because a candlestick's
 * newest bar is *open* and revises on every tick, a case an append-only log never produces.
 *
 * **What is honestly on the GPU here.** A few hundred visible bars is nothing for any renderer, and
 * §8.1's warning about leading with a weak claim applies. The real GPU work is: the resident
 * streaming buffer, pan and zoom as uniform writes (§5 gate 3), and the overview strip's bucketed
 * min/max/volume envelope across *every* bar in the history (§5 gate 2). The visible price range that
 * scales the y-axis is computed on the CPU, over the ~300 bars on screen, because §5.2 says small-N
 * work belongs there and a compute dispatch for 300 numbers would be theatre.
 */
export class CandlestickComponent implements GpuComponent<CandlestickProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private runtime: RuntimeHandle | null = null;
  private ring: RingBuffer | null = null;
  private params: SharedUniforms<Record<string, unknown>> | null = null;
  private overviewParams: SharedUniforms<Record<string, unknown>> | null = null;
  private candleDraw: Draw | null = null;
  private overviewDraw: Draw | null = null;
  private overviewCompute: Compute | null = null;
  private bucketBuffer: StorageBuffer | null = null;

  private readonly capacity: number;
  /** CPU mirror — §14.2's source of truth, and where the visible range is computed. */
  private cpuBars: Bar[] = [];
  private epochMs = 0;
  private consumed = 0;
  private lastSource: BarSource | null = null;

  private viewport: ViewportState | null = null;
  private pitchPx = DEFAULT_PITCH;
  private scrollLeftPx = 0;
  private firstVisible = 0;
  private visibleCount = 0;
  private overviewHeightPx = DEFAULT_OVERVIEW_H;
  private range = { min: 0, max: 1 };
  private overviewDirty = true;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.id = `candlestick-${nextId++}`;
    this.capacity = capacity;
  }

  create(ctx: ComponentContext): void {
    this.runtime = ctx.runtime;
    this.ring = new RingBuffer(ctx.gpu!, {
      stride: BAR_STRIDE,
      capacity: this.capacity,
      label: `${this.id}-bars`,
      caps: ctx.caps,
    });
    this.bucketBuffer = storage(ctx.gpu!, OVERVIEW_BUCKETS * 3 * 4, "read-write");

    this.params = uniforms(ctx.gpu!, {
      head: 0, count: 0, capacity: this.capacity, firstVisible: 0, visibleCount: 0,
      priceMin: 0, priceMax: 1, surfaceW: 1, surfaceH: 1, chartH: 1,
      pitchPx: DEFAULT_PITCH, bodyPx: DEFAULT_PITCH * 0.7, scrollPx: 0,
      hovered: -1, _pad0: 0, _pad1: 0,
    });
    this.overviewParams = uniforms(ctx.gpu!, {
      bucketCount: OVERVIEW_BUCKETS, lowest: 0, highest: 1, peakVolume: 1,
      surfaceW: 1, surfaceH: 1, heightPx: DEFAULT_OVERVIEW_H,
      windowStart: 0, windowEnd: 1, ready: 0, _pad0: 0, _pad1: 0,
    });

    this.candleDraw = draw(ctx.gpu!, {
      shader: CANDLE_WGSL, vertices: 6, blend: "alpha", label: `${this.id}-candles`,
    });
    this.overviewDraw = draw(ctx.gpu!, {
      shader: OVERVIEW_DRAW_WGSL, vertices: 6, blend: "alpha", label: `${this.id}-overview`,
    });
    this.overviewCompute = compute(ctx.gpu!, OVERVIEW_WGSL);

    this.candleDraw.set({ params: this.params, bars: this.ring.buffer });
    this.overviewDraw.set({ ov: this.overviewParams, buckets: this.bucketBuffer });
    this.overviewCompute.set({ params: this.params, bars: this.ring.buffer, buckets: this.bucketBuffer });

    // Device-loss replay from the CPU mirror (§14.2). Head is 0 after a fresh ring, so logical index
    // and slot coincide and no re-slotting is needed — unlike the log viewer, whose CPU mirror is
    // itself slot-indexed.
    if (this.cpuBars.length > 0) {
      this.ring.append(packBars(this.cpuBars, this.epochMs));
      this.overviewDirty = true;
    }
  }

  /**
   * Consumes new bars, and revises the open one.
   *
   * The append/overwrite split is the whole reason `RingBuffer.overwrite` exists. While a bar is
   * open, every tick rewrites one 24-byte record in place; when it closes, the next tick appends.
   * Neither path touches more than one record.
   */
  private ingest(source: BarSource): void {
    const ring = this.ring;
    if (!ring) return;

    if (source !== this.lastSource && source.bars.length < this.consumed) {
      ring.clear();
      this.consumed = 0;
      this.cpuBars = [];
    }
    this.lastSource = source;

    const incoming = source.bars.slice(this.consumed);
    if (incoming.length > 0) {
      validateBars(incoming);
      if (this.consumed === 0) this.epochMs = incoming[0]!.time;
      ring.append(packBars(incoming, this.epochMs));
      // A loop, not `push(...incoming)`. Spread passes every element as a separate argument, so a
      // 200,000-bar initial load overflowed the call stack — with a fully green test suite behind it,
      // because the tests topped out at 3,000 bars where spread is perfectly happy.
      for (let i = 0; i < incoming.length; i++) this.cpuBars.push(incoming[i]!);
      // The ring evicts silently; keep the mirror the same length so indices agree.
      if (this.cpuBars.length > this.capacity) {
        this.cpuBars.splice(0, this.cpuBars.length - this.capacity);
      }
      this.consumed = source.bars.length;
      this.overviewDirty = true;
    } else if (source.openBar && ring.state.count > 0) {
      // No new bars, but the newest one may have been revised in place by the host.
      const latest = source.bars[source.bars.length - 1];
      const mirrored = this.cpuBars[this.cpuBars.length - 1];
      if (latest && mirrored && !sameBar(latest, mirrored)) {
        validateBars([latest]);
        this.cpuBars[this.cpuBars.length - 1] = latest;
        ring.overwrite(ring.state.count - 1, packBars([latest], this.epochMs));
        this.overviewDirty = true;
      }
    }
  }

  update(props: CandlestickProps): void {
    this.ingest(props.source);

    const ring = this.ring;
    if (!ring) return;

    this.viewport = props.viewport;
    this.pitchPx = Math.max(1, props.pitchPx ?? DEFAULT_PITCH);
    this.overviewHeightPx = props.overviewHeightPx ?? DEFAULT_OVERVIEW_H;

    const count = ring.state.count;
    const chartH = Math.max(1, props.viewport.height - this.overviewHeightPx);
    const contentPx = count * this.pitchPx;
    const maxScroll = Math.max(0, contentPx - props.viewport.width);
    this.scrollLeftPx = props.follow
      ? maxScroll
      : Math.min(Math.max(props.scrollLeftPx ?? 0, 0), maxScroll);

    this.firstVisible = Math.floor(this.scrollLeftPx / this.pitchPx);
    this.visibleCount = Math.min(
      count - this.firstVisible,
      Math.ceil(props.viewport.width / this.pitchPx) + 1,
    );

    // Visible price range on the CPU, deliberately — see the class comment.
    this.range = priceRange(this.cpuBars, this.firstVisible, this.firstVisible + this.visibleCount);

    const { head, count: liveCount, capacity } = ring.state;
    this.params?.set({
      head,
      count: liveCount,
      capacity,
      firstVisible: this.firstVisible,
      visibleCount: Math.max(0, this.visibleCount),
      priceMin: this.range.min,
      priceMax: this.range.max,
      surfaceW: props.viewport.width,
      surfaceH: props.viewport.height,
      // Prices map into the candle area only; positions still map to clip through the full height.
      chartH,
      pitchPx: this.pitchPx,
      bodyPx: Math.max(1, this.pitchPx * BODY_RATIO),
      scrollPx: this.scrollLeftPx - this.firstVisible * this.pitchPx,
      hovered: props.hoveredBar ?? -1,
      _pad0: 0, _pad1: 0,
    });

    const windowStart = contentPx > 0 ? this.scrollLeftPx / contentPx : 0;
    const windowSpan = contentPx > 0 ? props.viewport.width / contentPx : 1;
    this.overviewParams?.set({
      bucketCount: OVERVIEW_BUCKETS,
      surfaceW: props.viewport.width,
      surfaceH: props.viewport.height,
      heightPx: this.overviewHeightPx,
      windowStart,
      windowEnd: Math.min(1, windowStart + windowSpan),
    });

    this.dirty = true;
  }

  get barCount(): number {
    return this.ring?.state.count ?? 0;
  }

  get scrollOffsetPx(): number {
    return this.scrollLeftPx;
  }

  get visiblePriceRange(): { min: number; max: number } {
    return this.range;
  }

  /** The bar under a screen x. Exact arithmetic — bars are a regular lattice, so no picking pass. */
  hitTest(x: number, y: number): HitResult | null {
    const ring = this.ring;
    if (!ring || !this.viewport) return null;
    if (x < 0 || x > this.viewport.width) return null;
    // Below the chart is the overview strip, which is not made of bars.
    if (y < 0 || y > this.viewport.height - this.overviewHeightPx) return null;
    const logical = Math.floor((this.scrollLeftPx + x) / this.pitchPx);
    if (logical < 0 || logical >= ring.state.count) return null;
    return { id: logical };
  }

  /** The bar at a logical index, for a crosshair readout. */
  barAt(logical: number): Bar | null {
    return this.cpuBars[logical] ?? null;
  }

  /**
   * Reads the overview envelope back and normalises the strip.
   *
   * A readback, and allowed on the same terms as `GPUImageDiff`'s and `GPULogViewer`'s: 96 buckets is
   * about 1KB, it runs when the data changes rather than per frame, and the series itself never comes
   * back to the CPU — only the summary of it.
   */
  async readOverview(): Promise<OverviewReading | null> {
    if (!this.bucketBuffer) return null;
    const raw = await this.bucketBuffer.read();
    const buckets = new Uint32Array(raw);
    const floats = new Float32Array(buckets.buffer);

    let lowest = Infinity;
    let highest = -Infinity;
    let peakVolume = 1;
    for (let i = 0; i < OVERVIEW_BUCKETS; i++) {
      // Empty buckets keep their sentinels: 0xffffffff for min, 0 for max. Both decode to values
      // that would wreck the envelope, so skip them rather than letting NaN reach the shader.
      if (buckets[i * 3] !== 0xffffffff) lowest = Math.min(lowest, floats[i * 3]!);
      if (buckets[i * 3 + 1] !== 0) highest = Math.max(highest, floats[i * 3 + 1]!);
      peakVolume = Math.max(peakVolume, buckets[i * 3 + 2] ?? 0);
    }
    if (!Number.isFinite(lowest) || !Number.isFinite(highest)) return null;

    this.overviewParams?.set({ lowest, highest, peakVolume, ready: 1 });

    // Ask for a frame. This resolves a tick or two after the dispatch that produced it, by which
    // point the scheduler has already drawn and gone quiet — so without this the strip stays blank
    // until something unrelated happens to invalidate. It was blank in the browser with every test
    // passing, because no test renders a second frame.
    this.dirty = true;
    this.runtime?.invalidate();

    return { lowest, highest, peakVolume, buckets };
  }

  plan(): RenderPlan {
    this.dirty = false;
    const ring = this.ring;
    if (!ring || ring.state.count === 0 || !this.viewport) return { computePasses: [], renderPasses: [] };

    const computePasses = this.overviewDirty
      ? [{ name: "candlestick-overview", dispatch: () => this.dispatchOverview() }]
      : [];
    this.overviewDirty = false;

    return {
      computePasses,
      renderPasses: [
        {
          name: "candlestick",
          target: "surface",
          clear: true,
          encode: (pass) => {
            if (pass.kind !== "gpu") return;
            if (this.visibleCount > 0 && this.candleDraw) {
              // Two instances per bar: body and wick, one pipeline.
              pass.frame.draw(this.candleDraw, { instances: this.visibleCount * 2 });
            }
            if (this.overviewDraw) {
              pass.frame.draw(this.overviewDraw, { instances: OVERVIEW_BUCKETS * 2 });
            }
          },
        },
      ],
    };
  }

  private dispatchOverview(): void {
    const ring = this.ring;
    if (!this.overviewCompute || !this.bucketBuffer || !ring) return;

    // Reset to the *sentinels* the reduction needs, not to zero: atomicMin starts at 0xffffffff and
    // atomicMax at 0. Zeroing all three — which is what the log viewer's histogram wants — would pin
    // every bucket's minimum at 0 and produce a flat envelope along the floor.
    // The previous normalisation described the previous data; stop drawing the envelope until the
    // next readOverview supplies extremes for this one.
    this.overviewParams?.set({ ready: 0 });

    const reset = new Uint32Array(OVERVIEW_BUCKETS * 3);
    for (let i = 0; i < OVERVIEW_BUCKETS; i++) reset[i * 3] = 0xffffffff;
    this.bucketBuffer.write(reset);

    this.overviewCompute.dispatch(Math.ceil(ring.state.count / OVERVIEW_WORKGROUP_SIZE));

    // Read it back from here, immediately after the dispatch, so the read is ordered behind the
    // compute on the GPU queue.
    //
    // The first attempt had the React wrapper do this on a 32ms timer and it lost the race: the
    // readback returned a buffer that had not even received the sentinel reset yet, so `highest`
    // came back -Infinity, `readOverview` bailed, `ready` never flipped and the strip stayed blank
    // in the browser with every test passing. Tests never saw it because they dispatch and read by
    // hand, in order. Ordering a readback by wall-clock guesswork was the mistake; ordering it by
    // the queue is not.
    void this.readOverview();
  }

  dispose(): void {
    this.ring?.dispose();
    this.ring = null;
  }
}

function sameBar(a: Bar, b: Bar): boolean {
  return (
    a.time === b.time && a.open === b.open && a.high === b.high &&
    a.low === b.low && a.close === b.close && a.volume === b.volume
  );
}
