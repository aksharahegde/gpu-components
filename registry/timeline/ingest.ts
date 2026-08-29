export interface RawSpan {
  readonly start: number;
  readonly duration: number;
  readonly track: number;
  readonly label?: string;
  readonly colorIndex?: number;
}

export interface SpanBuffers {
  readonly start: Float32Array;
  readonly duration: Float32Array;
  readonly track: Uint16Array;
  readonly colorIndex: Uint8Array;
  readonly labels: readonly (string | undefined)[];
  readonly count: number;
}

/** Bytes per instance in the WGSL `SpanInstance` struct: start(f32) + duration(f32) + track(u32) +
 * colorIndex(u32). Must match `timeline.wgsl.ts` exactly. */
export const INSTANCE_STRIDE = 16;

/**
 * Sorts spans by `(track, start)` once, at ingest — the CPU-side source of truth every GPU buffer
 * this component owns is derived from (PLAN.md §10.6's device-loss contract), and what makes future
 * CPU hit-testing an O(log n) binary search instead of a linear scan (PLAN.md §9.5). Synchronous for
 * v1 — no `Worker` — see PLAN.md's phase split; this is a perf concern for very large datasets, not
 * a correctness one.
 */
export function ingestSpans(spans: readonly RawSpan[]): SpanBuffers {
  const count = spans.length;
  const order = spans.map((_, i) => i).sort((a, b) => {
    const byTrack = spans[a]!.track - spans[b]!.track;
    if (byTrack !== 0) return byTrack;
    return spans[a]!.start - spans[b]!.start;
  });

  const start = new Float32Array(count);
  const duration = new Float32Array(count);
  const track = new Uint16Array(count);
  const colorIndex = new Uint8Array(count);
  const labels: (string | undefined)[] = new Array(count);

  order.forEach((sourceIndex, i) => {
    const span = spans[sourceIndex]!;
    start[i] = span.start;
    duration[i] = span.duration;
    track[i] = span.track;
    colorIndex[i] = span.colorIndex ?? sourceIndex % 6;
    labels[i] = span.label;
  });

  return { start, duration, track, colorIndex, labels, count };
}

/** Packs `spans` into the flat byte layout `timeline.wgsl.ts`'s `array<SpanInstance>` expects.
 * WebGPU storage buffers are host-byte-order (little-endian) on every supported platform. */
export function packInstances(spans: SpanBuffers): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(spans.count * INSTANCE_STRIDE);
  const view = new DataView(buffer);
  for (let i = 0; i < spans.count; i++) {
    const offset = i * INSTANCE_STRIDE;
    view.setFloat32(offset, spans.start[i]!, true);
    view.setFloat32(offset + 4, spans.duration[i]!, true);
    view.setUint32(offset + 8, spans.track[i]!, true);
    view.setUint32(offset + 12, spans.colorIndex[i]!, true);
  }
  return new Uint8Array(buffer);
}
