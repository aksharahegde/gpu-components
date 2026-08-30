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

/**
 * Keyboard navigation (PLAN.md §21.2) over the *full* dataset, not just what's currently visible —
 * `viewModel.ts`'s `visibleLabels()` only covers ≤400 labeled/on-screen spans. These reuse the same
 * `(track, start)` sort `hitTestSpans` already relies on, so a track's spans are a contiguous,
 * time-ordered run in the array: "next/prev in time within a track" is index±1 (no search needed),
 * and "nearest span on a different track" is one binary search.
 */

/** The next span after `index` on the same track (later start time), or `null` at the track's end.
 * `index` must be a valid span index already known to be on `track` (a caller-supplied invariant —
 * this does no bounds validation against `track` itself, only against the track's contiguous run). */
export function nextSpanInTrack(spans: SpanBuffers, track: number, index: number): number | null {
  const next = index + 1;
  return next < spans.count && spans.track[next] === track ? next : null;
}

/** The previous span before `index` on the same track (earlier start time), or `null` at the
 * track's start. Same invariant as `nextSpanInTrack`. */
export function prevSpanInTrack(spans: SpanBuffers, track: number, index: number): number | null {
  const prev = index - 1;
  return prev >= 0 && spans.track[prev] === track ? prev : null;
}

/** The span on `targetTrack` whose `start` is closest to `atTime` — for moving focus to an
 * adjacent track (`↑`/`↓`) and landing near where the visitor already was in time, not always at
 * the track's first span. `null` if `targetTrack` has no spans at all. */
export function nearestSpanOnTrack(spans: SpanBuffers, targetTrack: number, atTime: number): number | null {
  const trackStart = lowerBound(spans.track, 0, spans.count, targetTrack);
  const trackEnd = lowerBound(spans.track, trackStart, spans.count, targetTrack + 1);
  if (trackStart === trackEnd) return null;

  const at = lowerBound(spans.start, trackStart, trackEnd, atTime);
  const before = at - 1;
  const after = at;
  if (before < trackStart) return after;
  if (after >= trackEnd) return before;
  const beforeDist = Math.abs(spans.start[before]! - atTime);
  const afterDist = Math.abs(spans.start[after]! - atTime);
  return beforeDist <= afterDist ? before : after;
}

/** The dataset's first span in storage order (`Home`) — track 0's earliest span, not necessarily
 * the chronologically-first span across every track (tracks can overlap in time; there is no single
 * global time order without a second index this codebase doesn't otherwise need). `null` if empty. */
export function firstSpanIndex(spans: SpanBuffers): number | null {
  return spans.count > 0 ? 0 : null;
}

/** The dataset's last span in storage order (`End`) — see `firstSpanIndex`'s caveat. */
export function lastSpanIndex(spans: SpanBuffers): number | null {
  return spans.count > 0 ? spans.count - 1 : null;
}

/**
 * Brush selection's final id set (PLAN.md §9.5) — called once when a drag gesture ends, not per
 * frame, so a per-track *linear* scan (not a tight asymptotic bound) is the right tradeoff here:
 * simplicity over cleverness for a non-hot-path operation, same call `hitTestSpans` itself already
 * makes for within-track overlap handling. The live per-frame visual feedback during the drag comes
 * from the GPU bitset (`brushSelect.wgsl.ts`), not this function — this only supplies the id list an
 * app's `onBrushSelectionChange` callback receives.
 */
export function selectSpansInRange(
  spans: SpanBuffers,
  trackMin: number,
  trackMax: number,
  timeStart: number,
  timeEnd: number,
): number[] {
  const result: number[] = [];
  const lo = Math.max(0, Math.min(trackMin, trackMax));
  const hi = Math.max(trackMin, trackMax);
  for (let track = lo; track <= hi; track++) {
    const trackStart = lowerBound(spans.track, 0, spans.count, track);
    const trackEnd = lowerBound(spans.track, trackStart, spans.count, track + 1);
    for (let i = trackStart; i < trackEnd; i++) {
      const start = spans.start[i]!;
      const end = start + spans.duration[i]!;
      if (end >= timeStart && start <= timeEnd) result.push(i);
    }
  }
  return result;
}
