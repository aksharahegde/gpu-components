export interface RawSpan {
  readonly start: number;
  readonly duration: number;
  readonly track: number;
  readonly label?: string;
  readonly colorIndex?: number;
}

export interface SpanBuffers {
  /** Absolute time domain (same units/magnitude as the `RawSpan`s this was built from — e.g. raw
   * Unix epoch seconds). Kept as `Float64Array`, not `Float32Array`: this is the CPU-side source of
   * truth hit-testing, label placement, and viewport math (§10.6) read from, and downcasting an
   * epoch-scale absolute timestamp to f32 loses whole seconds of precision before any GPU code runs
   * (spikes/gpu-time-precision.md). GPU upload, where WGSL's f32-only storage buffers actually force
   * a narrowing, happens separately in `packInstances`/`packHighlights`, rebased to a dataset-local
   * origin so the narrowing loses microseconds instead of seconds. */
  readonly start: Float64Array;
  readonly duration: Float64Array;
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

  const start = new Float64Array(count);
  const duration = new Float64Array(count);
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

/**
 * The dataset-local time origin (minimum `start` across every track) used to rebase spans before
 * they're narrowed to f32 for the GPU (`packInstances`/`packHighlights`) — see
 * spikes/gpu-time-precision.md. Spans are sorted by `(track, start)`, not by `start` alone, so this
 * is a real O(n) scan, not `spans.start[0]`. Callers should compute this once per dataset (when
 * `spans` identity changes) and reuse it for every pack call against that dataset, not per frame.
 */
export function computeOrigin(spans: SpanBuffers): number {
  let origin = Infinity;
  for (let i = 0; i < spans.count; i++) {
    const s = spans.start[i]!;
    if (s < origin) origin = s;
  }
  return spans.count === 0 ? 0 : origin;
}

function writeInstance(
  view: DataView,
  offset: number,
  start: number,
  duration: number,
  track: number,
  colorIndex: number,
): void {
  view.setFloat32(offset, start, true);
  view.setFloat32(offset + 4, duration, true);
  view.setUint32(offset + 8, track, true);
  view.setUint32(offset + 12, colorIndex, true);
}

/**
 * Packs `spans` into the flat byte layout `timeline.wgsl.ts`'s `array<SpanInstance>` expects.
 * WebGPU storage buffers are host-byte-order (little-endian) on every supported platform.
 *
 * `origin` (default 0, from `computeOrigin`) is subtracted from `start` before the f32 narrowing —
 * the GPU only ever sees dataset-relative time, not the absolute (possibly epoch-scale) value in
 * `SpanBuffers.start`. Callers that also feed a viewport transform to the same shader (as
 * `TimelineComponent` does) MUST subtract the same `origin` from the viewport before computing
 * `viewportUniforms`, or clip-space positions won't line up with these instances.
 */
export function packInstances(spans: SpanBuffers, origin = 0): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(spans.count * INSTANCE_STRIDE);
  const view = new DataView(buffer);
  for (let i = 0; i < spans.count; i++) {
    writeInstance(view, i * INSTANCE_STRIDE, spans.start[i]! - origin, spans.duration[i]!, spans.track[i]!, spans.colorIndex[i]!);
  }
  return new Uint8Array(buffer);
}

/**
 * Packs up to two highlight instances — hover (kind 0) then selection (kind 1) — from their span
 * indices into `highlight.wgsl.ts`'s layout. `colorIndex` is repurposed there as the highlight kind.
 * Returns `count: 0` (an empty-but-valid buffer) when neither is set.
 */
export function packHighlights(
  spans: SpanBuffers,
  hoveredId: number | null,
  selectedId: number | null,
  origin = 0,
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly count: number } {
  const ids: Array<{ id: number; kind: number }> = [];
  if (hoveredId !== null && hoveredId >= 0 && hoveredId < spans.count) {
    ids.push({ id: hoveredId, kind: 0 });
  }
  if (selectedId !== null && selectedId !== hoveredId && selectedId >= 0 && selectedId < spans.count) {
    ids.push({ id: selectedId, kind: 1 });
  }

  const buffer = new ArrayBuffer(Math.max(1, ids.length) * INSTANCE_STRIDE);
  const view = new DataView(buffer);
  ids.forEach(({ id, kind }, i) => {
    writeInstance(view, i * INSTANCE_STRIDE, spans.start[id]! - origin, spans.duration[id]!, spans.track[id]!, kind);
  });
  return { bytes: new Uint8Array(buffer), count: ids.length };
}
