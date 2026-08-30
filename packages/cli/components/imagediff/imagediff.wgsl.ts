/**
 * `GPUImageDiff`'s compositing shader — the project's first shader to sample a **texture**.
 *
 * Every other shader here reads a storage buffer. That was the right call each time (a density
 * field, a matrix, cell values and point positions are all data, not pictures), but it meant the
 * whole texture path — `texture_2d<f32>`, a sampler, hardware filtering, `textureSampleLevel` —
 * was never exercised. Two images being compared are genuinely pictures, and filtering is exactly
 * what you want when zooming into them, so this is where that path earns its place.
 *
 * Four comparison modes, because no single one answers every question: `split` for "does this look
 * right", `onion` for alignment, `difference` for "what moved", and `heat` for "how much".
 */
export const IMAGE_DIFF_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct DiffParams {
  // 0 split, 1 onion, 2 difference, 3 heat — see DIFF_MODES in ingest.ts.
  mode: u32,
  // Split position and onion blend, both 0..1.
  split: f32,
  blend: f32,
  // Multiplies the difference so a subtle change is visible. 1 shows the raw delta.
  amplify: f32,
  // Below this per-channel delta a pixel counts as unchanged, matching the stats pass.
  threshold: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: DiffParams;
@group(0) @binding(2) var imageSampler: sampler;
@group(0) @binding(3) var beforeTex: texture_2d<f32>;
@group(0) @binding(4) var afterTex: texture_2d<f32>;

/** Low-to-high ramp for the heat mode: transparent where identical, hot where very different. */
fn heatRamp(t: f32) -> vec4f {
  let cool = vec3f(0.10, 0.16, 0.30);
  let mid = vec3f(0.95, 0.72, 0.25);
  let hot = vec3f(1.0, 0.29, 0.29);
  let c = select(mix(cool, mid, t * 2.0), mix(mid, hot, (t - 0.5) * 2.0), t > 0.5);
  return vec4f(c, 1.0);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // The viewport maps image pixels to clip space, so invert it to find which texel this fragment
  // is looking at. Same transform the other components use — an image is just a 2D domain.
  let clipX = 2.0 * uv.x - 1.0;
  let clipY = 1.0 - 2.0 * uv.y;
  let imgX = (clipX - viewport.timeToClip.y) / viewport.timeToClip.x;
  let imgY = (clipY - viewport.trackToClip.y) / viewport.trackToClip.x;

  let dims = vec2f(textureDimensions(beforeTex));
  let texCoord = vec2f(imgX, imgY) / dims;
  if (texCoord.x < 0.0 || texCoord.x > 1.0 || texCoord.y < 0.0 || texCoord.y > 1.0) {
    discard;
  }

  // textureSampleLevel, not textureSample: a fragment shader that may discard cannot use implicit
  // derivatives in uniform control flow, and level 0 is correct here because there are no mips.
  let a = textureSampleLevel(beforeTex, imageSampler, texCoord, 0.0);
  let b = textureSampleLevel(afterTex, imageSampler, texCoord, 0.0);

  if (params.mode == 0u) {
    // Split: the before image left of the divider, the after image right of it, plus a hairline so
    // the divider is visible against flat colour.
    let onLeft = texCoord.x < params.split;
    let edge = abs(texCoord.x - params.split) < (viewport.pxSize.x * 0.5) / 2.0;
    if (edge) {
      return vec4f(1.0, 1.0, 1.0, 1.0);
    }
    return select(b, a, onLeft);
  }

  if (params.mode == 1u) {
    return mix(a, b, params.blend);
  }

  let delta = abs(b.rgb - a.rgb);
  let magnitude = max(delta.r, max(delta.g, delta.b));

  if (params.mode == 2u) {
    // Difference: amplified delta on black, so "nothing changed" is unambiguous.
    return vec4f(clamp(delta * params.amplify, vec3f(0.0), vec3f(1.0)), 1.0);
  }

  // Heat: the after image, dimmed, with changed regions burning through it — keeps the change in
  // context, which a raw difference image loses.
  if (magnitude <= params.threshold) {
    return vec4f(b.rgb * 0.35, 1.0);
  }
  let hot = heatRamp(clamp(magnitude * params.amplify, 0.0, 1.0));
  return vec4f(mix(b.rgb * 0.35, hot.rgb, 0.85), 1.0);
}
`;

export const DIFF_STATS_WORKGROUP_SIZE = 8;

/**
 * Counts changed pixels — compute in the data path, over the whole image rather than the visible
 * region.
 *
 * This is what makes the component more than a picture viewer: "0.8% of pixels changed" is the
 * number a regression-test reviewer actually wants, and computing it on the CPU would mean walking
 * two multi-megapixel buffers on the main thread. It runs once per image pair, not per frame — the
 * range-reduction discipline `GPUHeatmap` established.
 */
export const DIFF_STATS_WGSL = /* wgsl */ `
struct StatsParams {
  width: u32,
  height: u32,
  threshold: f32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: StatsParams;
@group(0) @binding(1) var beforeTex: texture_2d<f32>;
@group(0) @binding(2) var afterTex: texture_2d<f32>;
// [changedPixels, maxDeltaMilli] — the second scaled to an integer because WGSL atomics are
// integer-only, the same constraint that shaped the heatmap's reduction.
@group(0) @binding(3) var<storage, read_write> stats: array<atomic<u32>>;

@compute @workgroup_size(${DIFF_STATS_WORKGROUP_SIZE}, ${DIFF_STATS_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) {
    return;
  }
  let coord = vec2i(i32(gid.x), i32(gid.y));
  // textureLoad, not a sampler: this is an exact per-texel comparison, and filtering would blur
  // the very differences being counted.
  let a = textureLoad(beforeTex, coord, 0);
  let b = textureLoad(afterTex, coord, 0);

  let delta = abs(b.rgb - a.rgb);
  let magnitude = max(delta.r, max(delta.g, delta.b));
  if (magnitude > params.threshold) {
    atomicAdd(&stats[0], 1u);
    atomicMax(&stats[1], u32(magnitude * 1000.0));
  }
}
`;
