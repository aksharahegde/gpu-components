/**
 * PLAN.md §12.2's `binSpans` step, scoped down (see `spikes/`-adjacent status note in PLAN.md's
 * Phase 2 section): time-range visibility culling only, no density-field binning. One invocation
 * per span; survivors are compacted into `visibleIndices` via an atomic append, and the same
 * append also produces the `args` buffer's `instanceCount` — the render draw reads both through
 * `InstancedQuadLayer.drawIndirect()`, so the CPU never learns (or needs) the visible count.
 *
 * Kept as a plain TS string, not a `.wgsl` file, for the same reason `timeline.wgsl.ts` is (see its
 * own doc comment): no bundler WGSL-loader plugin wired into this milestone yet.
 */
export const CULL_WGSL = /* wgsl */ `
struct SpanInstance {
  start: f32,
  duration: f32,
  track: u32,
  colorIndex: u32,
}

struct CullParams {
  timeStart: f32,
  timeEnd: f32,
  count: u32,
}

@group(0) @binding(0) var<uniform> params: CullParams;
@group(0) @binding(1) var<storage, read> instances: array<SpanInstance>;
@group(0) @binding(2) var<storage, read_write> visibleIndices: array<u32>;
// drawIndirect layout: [vertexCount, instanceCount, firstVertex, firstInstance]. Only
// instanceCount (index 1) is written here — vertexCount/firstVertex/firstInstance are reset from
// JS each frame (TimelineComponent.ts), same buffer, same bytes, no WGSL type conflict.
@group(0) @binding(3) var<storage, read_write> args: array<atomic<u32>>;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }

  let span = instances[i];
  let end = span.start + span.duration;
  if (end < params.timeStart || span.start > params.timeEnd) {
    return;
  }

  let slot = atomicAdd(&args[1], 1u);
  visibleIndices[slot] = i;
}
`;
