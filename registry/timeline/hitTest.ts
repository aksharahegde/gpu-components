import type { SpanBuffers } from "./ingest.ts";

/** Index of the first element `>= value` in `arr[lo, hi)`. Standard lower-bound binary search. */
function lowerBound(arr: ArrayLike<number>, lo: number, hi: number, value: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element `> value` in `arr[lo, hi)`. */
function upperBound(arr: ArrayLike<number>, lo: number, hi: number, value: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * CPU hit-testing (PLAN.md §9.5) — the primary mechanism for `GPUTimeline`, not a GPU-picking
 * fallback: `spans` is sorted `(track, start)` (see `ingest.ts`), so this is two binary searches,
 * O(log n), with no frame of latency.
 *
 * Returns the span index whose `[start, start + duration)` contains `time` on `track`, or `null`.
 * Real trace data can have overlapping spans within a track (nested calls, concurrent work); this
 * checks the binary search's landing point and its immediate predecessor rather than scanning the
 * whole track, which is enough for the common case (a handful of overlaps) without giving up the
 * O(log n) bound — documented as a v1 limitation, not a correctness guarantee for pathological
 * overlap density.
 */
export function hitTestSpans(spans: SpanBuffers, track: number, time: number): number | null {
  const trackStart = lowerBound(spans.track, 0, spans.count, track);
  const trackEnd = lowerBound(spans.track, trackStart, spans.count, track + 1);
  if (trackStart === trackEnd) return null; // no spans on this track

  // The last span in this track's range with start <= time.
  const candidate = upperBound(spans.start, trackStart, trackEnd, time) - 1;

  for (const i of [candidate, candidate - 1]) {
    if (i < trackStart || i >= trackEnd) continue;
    const start = spans.start[i]!;
    const end = start + spans.duration[i]!;
    if (time >= start && time < end) return i;
  }
  return null;
}
