import { RingBuffer } from "@gpu-components/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  RenderPlan,
  ViewportState,
} from "@gpu-components/core";
import { compute, draw, storage, uniforms } from "vgpu";
import type { Compute, Draw, SharedUniforms, StorageBuffer } from "vgpu";

/** vgpu's public `StorageBuffer` type omits the write offset the runtime actually supports. */
interface OffsetWritableBuffer extends StorageBuffer {
  write(data: BufferSource, offset?: number): void;
}
import {
  LOG_RECORD_STRIDE,
  formatLogLine,
  lineMatches,
  packLogRecords,
  type LogLine,
  type LogQuery,
} from "./ingest.ts";
import {
  LOG_ROWS_WGSL,
  MINIMAP_BUCKETS,
  MINIMAP_DRAW_WGSL,
  MINIMAP_WGSL,
  MINIMAP_WORKGROUP_SIZE,
} from "./logviewer.wgsl.ts";

/**
 * A growing log stream the component pulls from.
 *
 * Deliberately not "an immutable array in props". Every other component here takes its dataset by
 * value and re-uploads when the reference changes, which is right for data that does not grow —
 * but a host that appends to a million-line log by allocating a new million-line array each tick
 * has already lost more than the GPU can win back. So the host owns a mutable array and bumps
 * `version` to signal that it grew; the component appends only the tail it has not consumed.
 */
export interface LogSource {
  readonly lines: readonly LogLine[];
  /** Bump on append. Only exists to give React a changed value to re-render on. */
  readonly version: number;
}

export interface LogViewerProps {
  readonly source: LogSource;
  readonly viewport: ViewportState;
  /** Pixels scrolled from the top of the buffer. */
  readonly scrollTopPx?: number;
  readonly lineHeight?: number;
  readonly query?: LogQuery;
  readonly selectedLine?: number | null;
  /** Pin to the newest line, the way `tail -f` does. */
  readonly follow?: boolean;
}

export interface MinimapReading {
  /** `[matched, errors]` per bucket, oldest first. */
  readonly buckets: Uint32Array;
  readonly peakMatched: number;
  readonly peakErrors: number;
}

const DEFAULT_LINE_HEIGHT = 15;
const DEFAULT_CAPACITY = 1_000_000;
const STRIPE_WIDTH_PX = 3;
const MINIMAP_WIDTH_PX = 10;

let nextId = 0;

/**
 * `GPULogViewer` — a scrolling log over a GPU-resident ring.
 *
 * **The first component whose dataset has a tail.** Its reason to exist is not draw calls: a log
 * window is sixty rows, which is nothing for any renderer. It is that the *buffer* is a million
 * lines and every question the component answers is asked of all of them —
 *
 * - scrolling is a uniform write over resident data, never a re-upload (§5 gate 3);
 * - the minimap's match-and-error density is a compute reduction over every line, not the visible
 *   ones, which is the question a CPU cannot answer on the main thread (§5 gate 2);
 * - appending a line writes one 8-byte record at one offset, because `core`'s `RingBuffer` addresses
 *   the ring instead of reordering it.
 *
 * **Text is not on the GPU, and that is a measured decision, not a shortcut.**
 * `spikes/log-text-budget.md` put per-run Canvas2D text at 0.1ms for a realistic window and found no
 * crossover anywhere in the sweep where a glyph atlas would win. This component therefore renders
 * rows, stripes, selection and the minimap on the GPU, and hands the glyphs to a Canvas2D layer over
 * the top — the same split `GPUDataGrid` arrived at, for the same reason, from its own measurement.
 */
export class LogViewerComponent implements GpuComponent<LogViewerProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private ring: RingBuffer | null = null;
  private params: SharedUniforms<Record<string, unknown>> | null = null;
  private minimapParams: SharedUniforms<Record<string, unknown>> | null = null;
  private rowDraw: Draw | null = null;
  private minimapDraw: Draw | null = null;
  private minimapCompute: Compute | null = null;
  private matchBuffer: StorageBuffer | null = null;
  private bucketBuffer: StorageBuffer | null = null;

  private readonly capacity: number;
  /** CPU mirror of the ring: the text and the fields a search needs. §14.2's source-of-truth rule,
   * and also simply where the strings live, since §5.2 keeps them off the GPU. */
  private cpuLines: (LogLine | undefined)[];
  private cpuText: (string | undefined)[];
  private matchFlags: Uint32Array<ArrayBuffer>;

  private epochMs = 0;
  private consumed = 0;
  private lastSource: LogSource | null = null;
  private query: LogQuery | null = null;

  private viewport: ViewportState | null = null;
  private lineHeight = DEFAULT_LINE_HEIGHT;
  private scrollTopPx = 0;
  private firstVisible = 0;
  private visibleCount = 0;
  private selected: number | null = null;
  /** Set when the ring or the query changed, so the reduction reruns; cleared by `plan()`. */
  private minimapDirty = true;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.id = `logviewer-${nextId++}`;
    this.capacity = capacity;
    this.cpuLines = new Array(capacity);
    this.cpuText = new Array(capacity);
    this.matchFlags = new Uint32Array(new ArrayBuffer(capacity * 4));
  }

  create(ctx: ComponentContext): void {
    this.ring = new RingBuffer(ctx.gpu, {
      stride: LOG_RECORD_STRIDE,
      capacity: this.capacity,
      label: `${this.id}-lines`,
      caps: ctx.caps,
    });
    this.matchBuffer = storage(ctx.gpu, this.capacity * 4, "read");
    this.bucketBuffer = storage(ctx.gpu, MINIMAP_BUCKETS * 2 * 4, "read-write");

    this.params = uniforms(ctx.gpu, {
      head: 0, count: 0, capacity: this.capacity, firstVisible: 0,
      scrollPx: 0, lineHeightPx: DEFAULT_LINE_HEIGHT, surfaceW: 1, surfaceH: 1,
      stripeWidthPx: STRIPE_WIDTH_PX, selected: -1, filtering: 0, _pad: 0,
    });
    this.minimapParams = uniforms(ctx.gpu, {
      bucketCount: MINIMAP_BUCKETS, peakMatched: 1, peakErrors: 1,
      widthPx: MINIMAP_WIDTH_PX, surfaceW: 1, surfaceH: 1, windowStart: 0, windowEnd: 1,
    });

    this.rowDraw = draw(ctx.gpu, { shader: LOG_ROWS_WGSL, vertices: 6, blend: "alpha", label: `${this.id}-rows` });
    this.minimapDraw = draw(ctx.gpu, {
      shader: MINIMAP_DRAW_WGSL, vertices: 6, blend: "alpha", label: `${this.id}-minimap`,
    });
    this.minimapCompute = compute(ctx.gpu, MINIMAP_WGSL);

    this.rowDraw.set({ params: this.params, lines: this.ring.buffer, matches: this.matchBuffer });
    this.minimapDraw.set({ mm: this.minimapParams, buckets: this.bucketBuffer });
    this.minimapCompute.set({
      params: this.params, lines: this.ring.buffer,
      matches: this.matchBuffer, buckets: this.bucketBuffer,
    });

    // A device-loss replay lands here with an empty ring. §14.2 requires a CPU source of truth for
    // exactly this, and `cpuLines` is it — replay what survived rather than losing the session.
    if (this.consumed > 0) this.replayFromCpu();
  }

  /**
   * Re-uploads the CPU mirror after a device loss, preserving ring order.
   *
   * The mirror has to be **re-slotted**, not just re-uploaded. `clear()` puts the head back at 0, so
   * a line that used to live at slot 900,001 now lives at slot 0; writing the old arrays against the
   * new ring would leave the two disagreeing about which line is where, and every row would render
   * the wrong record. So the live lines are collected in logical order and the CPU arrays are rebuilt
   * in that order alongside the GPU upload.
   */
  private replayFromCpu(): void {
    const ring = this.ring;
    if (!ring) return;

    const live: LogLine[] = [];
    const liveText: string[] = [];
    const liveFlags: number[] = [];
    for (let i = 0; i < ring.state.count; i++) {
      const slot = ring.slotOf(i);
      const line = this.cpuLines[slot];
      if (!line) continue;
      live.push(line);
      liveText.push(this.cpuText[slot] ?? "");
      liveFlags.push(this.matchFlags[slot] ?? 1);
    }

    ring.clear();
    this.cpuLines = new Array(this.capacity);
    this.cpuText = new Array(this.capacity);
    this.matchFlags.fill(0);

    if (live.length > 0) {
      // Head is 0 after `clear()`, so logical index and slot coincide for this rebuild.
      ring.append(packLogRecords(live, this.epochMs));
      for (let i = 0; i < live.length; i++) {
        this.cpuLines[i] = live[i]!;
        this.cpuText[i] = liveText[i]!;
        this.matchFlags[i] = liveFlags[i]!;
      }
      this.matchBuffer?.write(this.matchFlags);
    }
    this.minimapDirty = true;
  }

  /**
   * Appends the tail of `source` that has not been consumed yet.
   *
   * The whole reason `RingBuffer` exists: this writes one record per new line at a computed offset,
   * so a thousand-line burst into a million-line buffer costs two `writeBuffer` calls rather than an
   * 8MB re-upload.
   */
  private ingest(source: LogSource): void {
    const ring = this.ring;
    if (!ring) return;

    if (source !== this.lastSource && source.lines.length < this.consumed) {
      // A different, shorter stream: this is a reset, not an append.
      ring.clear();
      this.consumed = 0;
      this.cpuLines = new Array(this.capacity);
      this.cpuText = new Array(this.capacity);
      this.matchFlags.fill(0);
    }
    this.lastSource = source;

    const incoming = source.lines.slice(this.consumed);
    if (incoming.length === 0) return;
    if (this.consumed === 0 && incoming.length > 0) this.epochMs = incoming[0]!.timestamp;

    // Slots the batch will occupy, resolved before the append moves the head.
    const startLogical = ring.state.count;
    const tailSlot = ring.slotOf(startLogical);

    const stored = ring.append(packLogRecords(incoming, this.epochMs));
    // Only the last `stored` lines survive a batch larger than the ring; mirror that on the CPU so
    // the two never disagree about what is live.
    const kept = incoming.slice(incoming.length - stored);

    for (let i = 0; i < kept.length; i++) {
      const slot = (tailSlot + i) % this.capacity;
      const line = kept[i]!;
      this.cpuLines[slot] = line;
      this.cpuText[slot] = formatLogLine(line);
      this.matchFlags[slot] = this.query && !lineMatches(line, this.query) ? 0 : 1;
    }
    this.writeMatchSlots(tailSlot, kept.length);

    this.consumed = source.lines.length;
    this.minimapDirty = true;
  }

  /** Writes `count` match flags starting at `slot`, splitting at the wrap — the same two-write shape
   * `RingBuffer.append` uses, because this buffer is addressed by the identical ring arithmetic. */
  private writeMatchSlots(slot: number, count: number): void {
    if (!this.matchBuffer || count === 0) return;
    const untilEnd = Math.min(count, this.capacity - slot);
    const writable = this.matchBuffer as OffsetWritableBuffer;
    writable.write(this.matchFlags.subarray(slot, slot + untilEnd), slot * 4);
    if (count > untilEnd) {
      writable.write(this.matchFlags.subarray(0, count - untilEnd), 0);
    }
  }

  /** Recomputes every live line's match flag. Runs on query change — a keystroke, not a frame. */
  private applyQuery(query: LogQuery | null): void {
    const ring = this.ring;
    if (!ring) return;
    this.query = query;
    for (let i = 0; i < ring.state.count; i++) {
      const slot = ring.slotOf(i);
      const line = this.cpuLines[slot];
      this.matchFlags[slot] = !line || !query || lineMatches(line, query) ? 1 : 0;
    }
    this.matchBuffer?.write(this.matchFlags);
    this.minimapDirty = true;
  }

  update(props: LogViewerProps): void {
    this.ingest(props.source);

    const query = props.query ?? null;
    const queryChanged =
      query?.text !== this.query?.text ||
      query?.caseSensitive !== this.query?.caseSensitive ||
      (query?.levels ?? []).join() !== (this.query?.levels ?? []).join();
    if (queryChanged) this.applyQuery(query);

    const ring = this.ring;
    if (!ring) return;

    this.viewport = props.viewport;
    this.lineHeight = props.lineHeight ?? DEFAULT_LINE_HEIGHT;
    this.selected = props.selectedLine ?? null;

    const count = ring.state.count;
    const contentPx = count * this.lineHeight;
    const maxScroll = Math.max(0, contentPx - props.viewport.height);
    this.scrollTopPx = props.follow ? maxScroll : Math.min(Math.max(props.scrollTopPx ?? 0, 0), maxScroll);

    this.firstVisible = Math.floor(this.scrollTopPx / this.lineHeight);
    this.visibleCount = Math.min(
      count - this.firstVisible,
      Math.ceil(props.viewport.height / this.lineHeight) + 1,
    );

    const { head, count: liveCount, capacity } = ring.state;
    this.params?.set({
      head,
      count: liveCount,
      capacity,
      firstVisible: this.firstVisible,
      // Only the sub-line remainder reaches the shader. Absolute scroll over a million 15px lines is
      // 15M pixels, at the edge of f32's exact-integer range; the remainder is always under 32.
      scrollPx: this.scrollTopPx - this.firstVisible * this.lineHeight,
      lineHeightPx: this.lineHeight,
      surfaceW: props.viewport.width,
      surfaceH: props.viewport.height,
      stripeWidthPx: STRIPE_WIDTH_PX,
      selected: this.selected ?? -1,
      filtering: query && query.text !== "" ? 1 : 0,
      _pad: 0,
    });

    const windowSpan = count > 0 ? props.viewport.height / Math.max(contentPx, 1) : 1;
    const windowStart = contentPx > 0 ? this.scrollTopPx / contentPx : 0;
    this.minimapParams?.set({
      bucketCount: MINIMAP_BUCKETS,
      widthPx: MINIMAP_WIDTH_PX,
      surfaceW: props.viewport.width,
      surfaceH: props.viewport.height,
      windowStart,
      windowEnd: Math.min(1, windowStart + windowSpan),
    });

    this.dirty = true;
  }

  /**
   * The visible lines, for the Canvas2D text layer and the accessible model.
   *
   * Returns logical indices alongside the text so the overlay can label rows by their position in
   * the whole stream rather than their position on screen — which is what a user means by "line
   * 812,004" and what a screen reader has to announce.
   */
  visibleLines(): readonly { logical: number; text: string; line: LogLine; matched: boolean }[] {
    const ring = this.ring;
    if (!ring) return [];
    const out: { logical: number; text: string; line: LogLine; matched: boolean }[] = [];
    for (let i = 0; i < this.visibleCount; i++) {
      const logical = this.firstVisible + i;
      const slot = ring.slotOf(logical);
      const line = this.cpuLines[slot];
      if (!line) continue;
      out.push({
        logical,
        text: this.cpuText[slot] ?? "",
        line,
        matched: this.matchFlags[slot] === 1,
      });
    }
    return out;
  }

  /** Total live lines — what the scrollbar and the a11y summary are sized from. */
  get lineCount(): number {
    return this.ring?.state.count ?? 0;
  }

  get scrollOffsetPx(): number {
    return this.scrollTopPx;
  }

  /** Exact, synchronous, and no picking pass: rows are a regular lattice, like the grid's. */
  hitTest(x: number, y: number): HitResult | null {
    const ring = this.ring;
    if (!ring || !this.viewport) return null;
    if (x < 0 || y < 0 || x > this.viewport.width || y > this.viewport.height) return null;
    const logical = Math.floor((this.scrollTopPx + y) / this.lineHeight);
    if (logical < 0 || logical >= ring.state.count) return null;
    return { id: logical };
  }

  /**
   * Reads the minimap buckets back.
   *
   * A readback, and permitted for the same reason `GPUImageDiff`'s is: it runs once per query or
   * append batch, not per frame, and it moves 1KB rather than the dataset. vgpu documents `read()`
   * as being for "tests, snapshots, and diagnostics"; normalising a 128-bucket histogram for display
   * is a diagnostic. The *data* never comes back to the CPU — only the summary of it.
   */
  async readMinimap(): Promise<MinimapReading | null> {
    if (!this.bucketBuffer) return null;
    const raw = await this.bucketBuffer.read();
    const buckets = new Uint32Array(raw);
    let peakMatched = 1;
    let peakErrors = 1;
    for (let i = 0; i < MINIMAP_BUCKETS; i++) {
      peakMatched = Math.max(peakMatched, buckets[i * 2] ?? 0);
      peakErrors = Math.max(peakErrors, buckets[i * 2 + 1] ?? 0);
    }
    this.minimapParams?.set({ peakMatched, peakErrors });
    return { buckets, peakMatched, peakErrors };
  }

  plan(): RenderPlan {
    this.dirty = false;
    const ring = this.ring;
    if (!ring || ring.state.count === 0 || !this.viewport) return { computePasses: [], renderPasses: [] };

    const computePasses = this.minimapDirty
      ? [{ name: "logviewer-minimap", dispatch: () => this.dispatchMinimap() }]
      : [];
    this.minimapDirty = false;

    return {
      computePasses,
      renderPasses: [
        {
          name: "logviewer",
          target: "surface" as const,
          clear: true,
          encode: (pass) => {
            // No Canvas2D fallback path: the rows are driven straight from the ring, and a fallback
            // that re-derives them on the CPU would be a second implementation of the component.
            if (pass.kind !== "gpu") return;
            if (this.visibleCount > 0 && this.rowDraw) {
              pass.frame.draw(this.rowDraw, { instances: this.visibleCount });
            }
            if (this.minimapDraw) {
              pass.frame.draw(this.minimapDraw, { instances: MINIMAP_BUCKETS });
            }
          },
        },
      ],
    };
  }

  private dispatchMinimap(): void {
    const ring = this.ring;
    if (!this.minimapCompute || !this.bucketBuffer || !ring) return;
    // Atomics accumulate, so a stale histogram would compound across queries.
    this.bucketBuffer.write(new Uint32Array(MINIMAP_BUCKETS * 2));
    this.minimapCompute.dispatch(Math.ceil(ring.state.count / MINIMAP_WORKGROUP_SIZE));
  }

  dispose(): void {
    this.ring?.dispose();
    this.ring = null;
  }
}
