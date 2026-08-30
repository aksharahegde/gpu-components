import type { Dataset, Shape } from "./types.ts";

/** Deterministic PRNG — every visitor/CI run benchmarks the identical dataset for a given
 * (shape, size, seed). Same algorithm as `apps/site/src/components/SpanBenchmark.tsx`. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_SEED = 0x5eed;

/** Many tracks, minimal nesting — spans scattered independently, one shallow layer per track. */
function generateShallowWide(size: number, rnd: () => number): Omit<Dataset, "shape" | "size"> {
  const trackCount = Math.max(8, Math.min(512, Math.round(Math.sqrt(size) * 2)));
  const start = new Float64Array(size);
  const duration = new Float64Array(size);
  const track = new Uint16Array(size);
  const colorIndex = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    start[i] = rnd();
    duration[i] = 0.0002 + rnd() * 0.01;
    track[i] = Math.floor(rnd() * trackCount);
    colorIndex[i] = i % 6;
  }
  return { trackCount, start, duration, track, colorIndex };
}

/**
 * Flame-graph-like: each span nests entirely inside its parent's time range, one track deeper.
 * Built iteratively (a work stack of open frames), not via true recursion, so it stays fast and
 * stack-safe at 10M spans. Depth is capped — real flame graphs rarely exceed a few hundred frames
 * deep, and an unbounded track count would blow past any renderer's viewport anyway.
 */
function generateDeepNested(size: number, rnd: () => number): Omit<Dataset, "shape" | "size"> {
  const MAX_DEPTH = 64;
  const start = new Float64Array(size);
  const duration = new Float64Array(size);
  const track = new Uint16Array(size);
  const colorIndex = new Uint8Array(size);

  type Frame = { readonly t0: number; readonly t1: number; readonly depth: number };
  let frontier: Frame[] = [{ t0: 0, t1: 1, depth: 0 }];
  let emitted = 0;
  let maxDepthSeen = 0;

  while (emitted < size && frontier.length > 0) {
    const next: Frame[] = [];
    for (const frame of frontier) {
      if (emitted >= size) break;
      const span = frame.t1 - frame.t0;
      start[emitted] = frame.t0;
      duration[emitted] = span;
      track[emitted] = frame.depth;
      colorIndex[emitted] = frame.depth % 6;
      emitted++;
      maxDepthSeen = Math.max(maxDepthSeen, frame.depth);

      if (frame.depth >= MAX_DEPTH || span < 1e-6) continue;
      // 2-4 children, each strictly inside the parent's range, with gaps (not every parent tick
      // is covered — realistic flame graphs have idle gaps between child calls).
      const childCount = 2 + Math.floor(rnd() * 3);
      let cursor = frame.t0 + span * 0.05 * rnd();
      const usable = span * 0.85;
      for (let c = 0; c < childCount; c++) {
        const childSpan = (usable / childCount) * (0.4 + rnd() * 0.6);
        const t0 = cursor;
        const t1 = Math.min(frame.t1, t0 + childSpan);
        if (t1 > t0) next.push({ t0, t1, depth: frame.depth + 1 });
        cursor = t0 + (usable / childCount);
      }
    }
    frontier = next;
  }

  // Fill any remainder (frontier exhausted before reaching `size`, e.g. small `size`) with
  // shallow top-level siblings rather than leaving trailing zeroed spans.
  while (emitted < size) {
    start[emitted] = rnd() * 0.95;
    duration[emitted] = 0.0005 + rnd() * 0.02;
    track[emitted] = 0;
    colorIndex[emitted] = emitted % 6;
    emitted++;
  }

  return { trackCount: maxDepthSeen + 1, start, duration, track, colorIndex };
}

/** Realistic trace clustering — matches `SpanBenchmark.tsx`'s `buildDataset` shape, extended with
 * a `colorIndex` bucket assignment for renderer parity. */
function generateBursty(size: number, rnd: () => number): Omit<Dataset, "shape" | "size"> {
  const trackCount = 8;
  const start = new Float64Array(size);
  const duration = new Float64Array(size);
  const track = new Uint16Array(size);
  const colorIndex = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const burst = Math.floor(rnd() * 240);
    start[i] = (burst / 240) * 0.94 + rnd() * 0.06;
    duration[i] = Math.pow(rnd(), 3) * 0.02 + 0.00004;
    track[i] = Math.floor(rnd() * trackCount);
    colorIndex[i] = i % 6;
  }
  return { trackCount, start, duration, track, colorIndex };
}

export function generateDataset(shape: Shape, size: number, seed = DEFAULT_SEED): Dataset {
  const rnd = mulberry32(seed);
  const base =
    shape === "shallow-wide"
      ? generateShallowWide(size, rnd)
      : shape === "deep-nested"
        ? generateDeepNested(size, rnd)
        : generateBursty(size, rnd);
  return { shape, size, ...base };
}
