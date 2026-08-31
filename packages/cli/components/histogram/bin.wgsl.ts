/**
 * GPU histogram binning: one thread per value, atomicAdd into fixed buckets.
 */

export const BIN_WORKGROUP_SIZE = 64;

export const BIN_WGSL = /* wgsl */ `
struct BinParams {
  domainMin: f32,
  domainSpan: f32,
  binCount: u32,
  count: u32,
}

@group(0) @binding(0) var<uniform> params: BinParams;
@group(0) @binding(1) var<storage, read> values: array<f32>;
@group(0) @binding(2) var<storage, read_write> bins: array<atomic<u32>>;

@compute @workgroup_size(${BIN_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }
  let v = values[i];
  if (v != v) {
    return;
  }
  let t = (v - params.domainMin) / max(params.domainSpan, 1e-20);
  if (t < 0.0 || t > 1.0) {
    return;
  }
  var b = u32(floor(t * f32(params.binCount)));
  if (b >= params.binCount) {
    b = params.binCount - 1u;
  }
  atomicAdd(&bins[b], 1u);
}
`;
