/**
 * PLAN.md §12.2's `binSpans` step for the raster-LOD path (the density-field half `cull.wgsl.ts`
 * deliberately left out — see that file's doc comment). One invocation per span: if it overlaps the
 * current viewport's time range, atomically increments the density bucket at its *start time*'s
 * pixel column on its track row.
 *
 * **Stated approximation, not silently precise:** a span contributes to the single column its start
 * time falls in, not every column it visually spans. A per-thread loop over covered columns would be
 * unbounded (a root-level flame-graph frame can cover the entire visible range), and raster LOD
 * exists precisely for the zoomed-out case where density comes from *many small overlapping spans*,
 * not a few wide ones — so the undercount this causes for wide spans is an acceptable, bounded
 * trade, not an oversight.
 *
 * Reuses `cull.wgsl.ts`'s `CullParams`/`SpanInstance` struct shapes verbatim (own copies — WGSL has
 * no cross-shader imports here per PLAN.md §13.2/§13.3's "shaders are build-time artefacts, not a
 * shared module system" for v1) so the two compute passes agree on layout without a shared import.
 */
export const DENSITY_BIN_WGSL = /* wgsl */ `
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

struct DensityParams {
  pixelColumns: u32,
  trackCount: u32,
}

@group(0) @binding(0) var<uniform> params: CullParams;
@group(0) @binding(1) var<storage, read> instances: array<SpanInstance>;
@group(0) @binding(2) var<uniform> density_params: DensityParams;
@group(0) @binding(3) var<storage, read_write> density: array<atomic<u32>>;

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
  if (span.track >= density_params.trackCount) {
    return;
  }

  let domainSpan = max(params.timeEnd - params.timeStart, 1e-9);
  let t = clamp((span.start - params.timeStart) / domainSpan, 0.0, 1.0);
  let column = min(u32(t * f32(density_params.pixelColumns)), density_params.pixelColumns - 1u);
  let index = span.track * density_params.pixelColumns + column;
  atomicAdd(&density[index], 1u);
}
`;
