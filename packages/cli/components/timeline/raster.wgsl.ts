/**
 * PLAN.md §12.1's `RasterLayer`: "a texture drawn through `effect(gpu, …)` with a colormap. Used
 * for LOD density fields." One full-screen fragment pass reading `density`/`maxPerTrack`
 * (`densityBin.wgsl.ts`/`reduceDensity.wgsl.ts`'s output) instead of a texture — see
 * `packages/core/src/layers/rasterLayer.ts`'s doc comment for why a storage buffer, not a real
 * texture, backs this.
 *
 * Reuses `timeline.wgsl.ts`'s `Viewport` struct shape verbatim (own copy — no shared WGSL module
 * system for shaders yet, PLAN.md §13.2/§13.3) so both shaders' viewport uniform stays byte-compatible
 * with the one `SharedUniforms<ViewportUniforms>` object `TimelineComponent` binds to both.
 */
export const RASTER_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct DensityParams {
  pixelColumns: u32,
  trackCount: u32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> density_params: DensityParams;
@group(0) @binding(2) var<storage, read> density: array<u32>;
@group(0) @binding(3) var<storage, read> maxPerTrack: array<u32>;

/** A sequential intensity ramp (surface → deep accent), distinct from \`timeline.wgsl.ts\`'s
 * categorical span \`PALETTE\` — density is one continuous quantity, not six discrete categories.
 * Runs light-to-dark so that "more" reads as "heavier" on a light surface; \`lo\` is the clear
 * colour, which makes the empty end of the ramp vanish into the canvas as it should. */
fn colormap(t: f32) -> vec3f {
  // \`lo\` is the colour of the *least busy occupied* bin, not of an empty one — \`fs_main\`
  // discards \`value == 0u\` before reaching here, so nothing is gained by anchoring \`lo\` on the
  // clear colour and a visible floor is what separates "one span here" from "no spans here".
  //
  // The square root is a display curve, not a change to the data: bin counts in a realistic trace
  // are heavily skewed toward the low end, so a linear ramp spends almost all of its range on the
  // handful of hottest bins and renders everything else as the same near-empty tint. Anchoring
  // \`lo\` at the clear colour *and* mapping linearly was the first attempt, and it flattened the
  // whole field to near-white.
  let s = sqrt(clamp(t, 0.0, 1.0));
  let lo = vec3f(0.816, 0.843, 0.945);
  let hi = vec3f(0.157, 0.208, 0.639);
  return mix(lo, hi, s);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // \`trackToClip\` maps a track index to its clip-space row center (timeline.wgsl.ts's vs_main
  // does the same mapping forward; this is its inverse). uv.y is top-origin [0,1]; clip space is
  // bottom-origin [-1,1] — flip before inverting.
  let clipY = 1.0 - 2.0 * uv.y;
  let track = u32(round((clipY - viewport.trackToClip.y) / viewport.trackToClip.x));
  if (track >= density_params.trackCount) {
    discard;
  }

  let column = min(u32(uv.x * f32(density_params.pixelColumns)), density_params.pixelColumns - 1u);
  let index = track * density_params.pixelColumns + column;
  let value = density[index];
  if (value == 0u) {
    discard;
  }

  let maxValue = max(maxPerTrack[track], 1u);
  let intensity = f32(value) / f32(maxValue);
  return vec4f(colormap(intensity), 0.85);
}
`;
