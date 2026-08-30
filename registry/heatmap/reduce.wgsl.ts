/**
 * Min/max reduction over the value matrix — PLAN.md §5.1's "Reductions: min/max/sum/count for
 * auto-ranging axes", and the piece that makes this component a real test of *compute in the data
 * path* rather than just another textured quad.
 *
 * Two passes rather than one, and deliberately not atomics. WGSL's atomics are integer-only, so an
 * f32 min/max would need the monotonic float→u32 ordering trick — clever, and wrong to reach for
 * when a plain tree reduction is exact, portable and easy to check against a CPU oracle
 * (`computeRange` in `ingest.ts`). Pass 1 reduces each workgroup's chunk into `partials`; pass 2
 * reduces `partials` into the two-element `range` buffer the render shader reads. Neither result
 * ever reaches the CPU (§5, gate 4).
 */

export const REDUCE_WORKGROUP_SIZE = 256;

/** Pass 1: one workgroup per chunk, tree-reduced in workgroup memory into `partials[wg*2..+1]`. */
export const REDUCE_CHUNK_WGSL = /* wgsl */ `
struct ReduceParams {
  count: u32,
  chunkCount: u32,
}

@group(0) @binding(0) var<uniform> params: ReduceParams;
@group(0) @binding(1) var<storage, read> values: array<f32>;
@group(0) @binding(2) var<storage, read_write> partials: array<f32>;

const WG: u32 = ${REDUCE_WORKGROUP_SIZE}u;

var<workgroup> sharedMin: array<f32, WG>;
var<workgroup> sharedMax: array<f32, WG>;

@compute @workgroup_size(${REDUCE_WORKGROUP_SIZE})
fn cs_main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  // Grid-stride so a matrix larger than (workgroups x WG) is still fully covered.
  var localMin = 0.0;
  var localMax = 0.0;
  var seen = false;

  var i = gid.x;
  let stride = WG * params.chunkCount;
  loop {
    if (i >= params.count) { break; }
    let v = values[i];
    if (v == v) {           // skips NaN holes, matching computeRange()
      if (!seen) {
        localMin = v;
        localMax = v;
        seen = true;
      } else {
        localMin = min(localMin, v);
        localMax = max(localMax, v);
      }
    }
    i = i + stride;
  }

  // An unseen lane must not drag the result: seed it with the identity for each side.
  sharedMin[lid.x] = select(0x1p+127f, localMin, seen);
  sharedMax[lid.x] = select(-0x1p+127f, localMax, seen);
  workgroupBarrier();

  var step = WG / 2u;
  loop {
    if (step == 0u) { break; }
    if (lid.x < step) {
      sharedMin[lid.x] = min(sharedMin[lid.x], sharedMin[lid.x + step]);
      sharedMax[lid.x] = max(sharedMax[lid.x], sharedMax[lid.x + step]);
    }
    workgroupBarrier();
    step = step / 2u;
  }

  if (lid.x == 0u) {
    partials[wid.x * 2u] = sharedMin[0];
    partials[wid.x * 2u + 1u] = sharedMax[0];
  }
}
`;

/** Pass 2: a single workgroup folds `partials` into `range = [min, max]`. */
export const REDUCE_FINAL_WGSL = /* wgsl */ `
struct ReduceParams {
  count: u32,
  chunkCount: u32,
}

@group(0) @binding(0) var<uniform> params: ReduceParams;
@group(0) @binding(1) var<storage, read> partials: array<f32>;
@group(0) @binding(2) var<storage, read_write> range: array<f32>;

@compute @workgroup_size(1)
fn cs_main() {
  var lo = 0x1p+127f;
  var hi = -0x1p+127f;
  var i: u32 = 0u;
  loop {
    if (i >= params.chunkCount) { break; }
    lo = min(lo, partials[i * 2u]);
    hi = max(hi, partials[i * 2u + 1u]);
    i = i + 1u;
  }

  // An all-NaN (or empty) matrix leaves the identities untouched; fall back to [0,1] so the render
  // shader's normalisation stays finite, exactly as computeRange() does on the CPU.
  if (lo > hi) {
    lo = 0.0;
    hi = 1.0;
  } else if (lo == hi) {
    hi = lo + 1.0;
  }
  range[0] = lo;
  range[1] = hi;
}
`;
