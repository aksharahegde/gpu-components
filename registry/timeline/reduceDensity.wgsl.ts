/**
 * PLAN.md §12.2's `reduceDensity` step: one invocation per `(track, column)` cell, folding
 * `density` (written by `densityBin.wgsl.ts`) down to one max-per-track value —
 * `raster.wgsl.ts` normalizes each track's colormap against its own max, so a sparse track and a
 * dense track both use their full color range instead of one shared (and mostly wasted) scale.
 */
export const REDUCE_DENSITY_WGSL = /* wgsl */ `
struct DensityParams {
  pixelColumns: u32,
  trackCount: u32,
}

@group(0) @binding(0) var<uniform> density_params: DensityParams;
@group(0) @binding(1) var<storage, read> density: array<u32>;
@group(0) @binding(2) var<storage, read_write> maxPerTrack: array<atomic<u32>>;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let total = density_params.pixelColumns * density_params.trackCount;
  if (i >= total) {
    return;
  }

  let track = i / density_params.pixelColumns;
  let value = density[i];
  if (value > 0u) {
    atomicMax(&maxPerTrack[track], value);
  }
}
`;
