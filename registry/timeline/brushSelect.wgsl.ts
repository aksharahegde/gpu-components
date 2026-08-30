/**
 * PLAN.md §9.5's brush/lasso selection, "Hybrid: CPU computes the region; a compute pass tests
 * every element against it and writes a bitset mask in a storage buffer; the render shader branches
 * on the bit." One invocation per span: if it overlaps the brush's time range AND falls within its
 * track range, atomically sets its bit in `selectionMask` (1 bit/span, packed 32 per `u32` word) —
 * `timeline.wgsl.ts`'s `isSelected()` reads the same buffer to tint it, no separate draw, no CPU set.
 *
 * Own copy of the `SpanInstance`/`BrushParams` struct shapes (no shared WGSL module system for v1 —
 * see `cull.wgsl.ts`'s doc comment for why), extended with a track range `cull.wgsl.ts`'s
 * `CullParams` doesn't need (visibility culling only cares about time; the brush is a 2D rectangle).
 */
export const BRUSH_SELECT_WGSL = /* wgsl */ `
struct SpanInstance {
  start: f32,
  duration: f32,
  track: u32,
  colorIndex: u32,
}

struct BrushParams {
  timeStart: f32,
  timeEnd: f32,
  trackMin: u32,
  trackMax: u32,
  count: u32,
}

@group(0) @binding(0) var<uniform> params: BrushParams;
@group(0) @binding(1) var<storage, read> instances: array<SpanInstance>;
@group(0) @binding(2) var<storage, read_write> selectionMask: array<atomic<u32>>;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }

  let span = instances[i];
  if (span.track < params.trackMin || span.track > params.trackMax) {
    return;
  }
  let end = span.start + span.duration;
  if (end < params.timeStart || span.start > params.timeEnd) {
    return;
  }

  let word = i / 32u;
  let bit = 1u << (i % 32u);
  atomicOr(&selectionMask[word], bit);
}
`;
