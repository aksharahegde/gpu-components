/**
 * Max reduction over hex density counts — integer atomics, same shape as timeline's
 * `reduceDensity` but a single global max for colormap normalisation.
 */

export const REDUCE_MAX_WORKGROUP_SIZE = 64;

export const REDUCE_MAX_WGSL = /* wgsl */ `
struct ReduceParams {
  cellCount: u32,
}

@group(0) @binding(0) var<uniform> params: ReduceParams;
@group(0) @binding(1) var<storage, read> density: array<u32>;
@group(0) @binding(2) var<storage, read_write> maxCount: array<atomic<u32>>;

@compute @workgroup_size(${REDUCE_MAX_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.cellCount) {
    return;
  }
  let value = density[i];
  if (value > 0u) {
    atomicMax(&maxCount[0], value);
  }
}
`;
