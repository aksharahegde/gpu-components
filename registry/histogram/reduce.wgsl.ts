/** Max reduction over histogram bin counts for bar-height normalisation. */

export const REDUCE_MAX_WORKGROUP_SIZE = 64;

export const REDUCE_MAX_WGSL = /* wgsl */ `
struct ReduceParams {
  binCount: u32,
}

@group(0) @binding(0) var<uniform> params: ReduceParams;
@group(0) @binding(1) var<storage, read> bins: array<u32>;
@group(0) @binding(2) var<storage, read_write> maxCount: array<atomic<u32>>;

@compute @workgroup_size(${REDUCE_MAX_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.binCount) {
    return;
  }
  let value = bins[i];
  if (value > 0u) {
    atomicMax(&maxCount[0], value);
  }
}
`;
