import { storage } from "vgpu";
import type { Gpu, StorageBuffer } from "vgpu";
import type { Capabilities } from "./capabilities.ts";
import { assertBufferBudget } from "./budget.ts";

/**
 * A fixed-capacity ring of equal-sized records in a storage buffer (PLAN.md §5 gate 3).
 *
 * **The first thing in this project to mutate a GPU buffer incrementally.** Every component built so
 * far uploads an immutable dataset and rewrites the whole buffer when it changes — the timeline's
 * spans, the heatmap's matrix, the scatter's points, the grid's columns, the graph's nodes, the
 * image diff's textures. §5 gate 3 describes that as the ideal GPU case ("upload once, re-render
 * from a changed uniform") and it is, but it quietly became an *assumption* the runtime had never
 * been tested against: nothing here had a dataset with a tail.
 *
 * A log stream does. So does anything live — market ticks, metrics, telemetry. Rewriting a
 * million-record buffer to append one record is the obvious wrong answer, and it is the only answer
 * the runtime could express before this file existed.
 *
 * vgpu can do the write this needs, but does not *declare* that it can — see `OffsetWritableBuffer`
 * below. Nothing in this project had ever passed a write offset, so the gap had never surfaced.
 *
 * **What the shader sees.** The ring is not reordered on the GPU. `head` and `count` are exposed so a
 * shader maps a logical index to a physical slot itself:
 *
 * ```wgsl
 * let slot = (params.head + logicalIndex) % params.capacity;
 * ```
 *
 * That is one modulo per invocation and no data movement, which is the entire point: appending stays
 * O(new records) instead of O(capacity), and the oldest record falls off the end for free.
 */

/**
 * What this file needs from a storage buffer, beyond what vgpu's public types promise.
 *
 * `StorageBuffer` — the interface `storage()` is declared to return — has `write(data)` and no
 * `destroy()`. The object actually returned is `RingStorageBuffer`, whose `write(data, offset?)` and
 * `destroy()` are real, documented in `storage.d.ts`, and marked `@internal`. So the capability
 * exists and the *type* does not admit it.
 *
 * §30 risk 3 anticipates precisely this ("vgpu is young; a missing capability blocks us") and
 * prescribes the mitigation this is: keep the vgpu assumption inside `core`, behind our own
 * interface, so a future vgpu change is a one-file fix rather than a search across seven components.
 * The constructor checks for the capability at runtime rather than trusting the cast, because a cast
 * that turns out to be wrong should fail at mount with a sentence explaining why — not at the first
 * ring wrap, in production, as silently corrupted data.
 */
interface OffsetWritableBuffer extends StorageBuffer {
  write(data: BufferSource, offset?: number): void;
  destroy?(): void;
}

export interface RingBufferOptions {
  /** Bytes per record. Must match the shader's struct stride. */
  readonly stride: number;
  /** Maximum records held. Older records are overwritten once it is reached. */
  readonly capacity: number;
  readonly label?: string;
  /** Device limits, so an oversized ring fails with a typed error rather than a driver rejection. */
  readonly caps?: Pick<Capabilities, "maxStorageBufferBindingSize" | "maxBufferSize"> | null;
}

/** The ring's addressing state, shaped for a uniform block. */
export interface RingState {
  /** Physical slot of the oldest live record. */
  readonly head: number;
  /** Live records — rises to `capacity`, then stops. */
  readonly count: number;
  readonly capacity: number;
  /** Records appended over the ring's whole life, including evicted ones. Never wraps in practice:
   * at a million appends a second this stays exact for over 250 years. */
  readonly totalAppended: number;
}

export class RingBuffer {
  readonly stride: number;
  readonly capacity: number;
  readonly buffer: StorageBuffer;
  /** The same object, typed with the offset write this class is built on. */
  private readonly writable: OffsetWritableBuffer;

  private headSlot = 0;
  private liveCount = 0;
  private appended = 0;

  constructor(gpu: Gpu, options: RingBufferOptions) {
    const { stride, capacity } = options;
    if (!Number.isInteger(stride) || stride <= 0) {
      throw new RangeError(`gpu-components: ring stride must be a positive integer, got ${stride}`);
    }
    // WebGPU requires buffer write offsets to be 4-byte aligned. A stride that is not a multiple of
    // 4 would make every append past the first land on an illegal offset, so reject it here rather
    // than at the first wrap — which is the kind of bug that only shows up under load.
    if (stride % 4 !== 0) {
      throw new RangeError(`gpu-components: ring stride must be a multiple of 4 bytes, got ${stride}`);
    }
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`gpu-components: ring capacity must be a positive integer, got ${capacity}`);
    }

    const bytes = stride * capacity;
    if (options.caps) assertBufferBudget(options.caps, bytes, options.label ?? "ring buffer", stride);

    this.stride = stride;
    this.capacity = capacity;

    // The cast is the whole vgpu assumption this class rests on, isolated to one line.
    //
    // There is deliberately no runtime probe here. The obvious one — `write.length >= 2` — was tried
    // and is wrong: `Function.length` counts parameters up to the first optional one, so
    // `write(data, offset?)` reports 1 on the very class both Dawn and the mock return. An arity
    // check would have rejected a buffer that works perfectly.
    //
    // What actually verifies this capability is `registry/logviewer/render.pixels.test.ts`, which
    // fills a ring past its capacity on a real device and asserts that the rows on screen are the
    // records that should have survived. An offset write that silently landed at 0 would put the
    // wrong lines on screen and that test would fail. A behavioural check on a real GPU beats a
    // reflective guess about a function signature.
    const buffer = storage(gpu, bytes, "read-write") as OffsetWritableBuffer;
    this.buffer = buffer;
    this.writable = buffer;
  }

  get state(): RingState {
    return {
      head: this.headSlot,
      count: this.liveCount,
      capacity: this.capacity,
      totalAppended: this.appended,
    };
  }

  /** Physical slot holding logical record `i`, where 0 is the oldest live record. Mirrors the
   * modulo a shader does, and exists so tests and hit-testing agree with the GPU exactly. */
  slotOf(logicalIndex: number): number {
    return (this.headSlot + logicalIndex) % this.capacity;
  }

  /**
   * Appends whole records, evicting the oldest when full.
   *
   * Costs at most two `write` calls regardless of how many records arrive: one to the tail of the
   * buffer and, when the batch crosses the end, one to the front. The wrap is where an incremental
   * ring earns its keep and also where it is easiest to get wrong, so it is handled here once rather
   * than in every component that streams.
   */
  append(records: ArrayBufferView): number {
    const { stride, capacity } = this;
    if (records.byteLength === 0) return 0;
    if (records.byteLength % stride !== 0) {
      throw new RangeError(
        `gpu-components: ring append must be a whole number of ${stride}-byte records, ` +
          `got ${records.byteLength} bytes`,
      );
    }

    let incoming = records.byteLength / stride;
    let sourceRecord = 0;

    // A batch larger than the ring would wrap onto itself and leave the buffer holding an arbitrary
    // slice. Keep the newest `capacity` records — the only answer that matches what a ring means —
    // and skip writing the rest at all rather than writing then overwriting them.
    if (incoming > capacity) {
      sourceRecord = incoming - capacity;
      incoming = capacity;
    }

    // Where the next record goes: one past the last live record, wrapped.
    const tail = (this.headSlot + this.liveCount) % capacity;
    const untilEnd = Math.min(incoming, capacity - tail);

    // The buffers this ring is used with are always plain ArrayBuffers; SharedArrayBuffer support
    // isn't part of the contract, so this narrows the untyped view back to what `write()` expects.
    const bytes = new Uint8Array(records.buffer, records.byteOffset, records.byteLength) as Uint8Array<ArrayBuffer>;
    const from = sourceRecord * stride;

    this.writable.write(bytes.subarray(from, from + untilEnd * stride), tail * stride);
    if (incoming > untilEnd) {
      this.writable.write(bytes.subarray(from + untilEnd * stride, from + incoming * stride), 0);
    }

    this.appended += incoming;
    const overflow = this.liveCount + incoming - capacity;
    if (overflow > 0) {
      // Full: the head advances by exactly as many records as were pushed off the front.
      this.headSlot = (this.headSlot + overflow) % capacity;
      this.liveCount = capacity;
    } else {
      this.liveCount += incoming;
    }
    return incoming;
  }

  /**
   * Overwrites one record that is already live.
   *
   * **Added by the ring's second consumer, which is the point of having one.** `GPULogViewer` only
   * ever appends — a log line, once written, is history — so `append()` was the whole API and looked
   * complete. `GPUCandlestick` broke that assumption immediately: the newest bar is *open*, and every
   * incoming tick revises its high, low, close and volume. Expressing that with append-only would
   * mean either a redundant record per tick or a full re-upload, and the ring exists to avoid exactly
   * those two things.
   *
   * `logicalIndex` is counted from the oldest live record, matching `slotOf` and the shaders.
   */
  overwrite(logicalIndex: number, record: ArrayBufferView): void {
    if (!Number.isInteger(logicalIndex) || logicalIndex < 0 || logicalIndex >= this.liveCount) {
      throw new RangeError(
        `gpu-components: ring overwrite index ${logicalIndex} is outside the ${this.liveCount} live records`,
      );
    }
    if (record.byteLength !== this.stride) {
      throw new RangeError(
        `gpu-components: ring overwrite needs exactly one ${this.stride}-byte record, got ${record.byteLength} bytes`,
      );
    }
    const bytes = new Uint8Array(record.buffer, record.byteOffset, record.byteLength) as Uint8Array<ArrayBuffer>;
    // One record never straddles the end — slots are whole records — so this is always one write.
    this.writable.write(bytes, this.slotOf(logicalIndex) * this.stride);
  }

  /** Drops every record without reallocating. The GPU memory keeps whatever it held; nothing reads
   * past `count`, which is the same contract the ring already relies on before it first fills. */
  clear(): void {
    this.headSlot = 0;
    this.liveCount = 0;
    this.appended = 0;
  }

  dispose(): void {
    // vgpu destroys storage buffers with the device. A ring is large enough to be worth releasing
    // earlier when a component unmounts, and `destroy()` is documented as idempotent.
    this.writable.destroy?.();
  }
}
