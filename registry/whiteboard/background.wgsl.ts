/**
 * Procedural dot-grid background — the "infinite canvas" visual signature. A `RasterLayer`
 * full-screen pass, not geometry: the grid is computed per-pixel from the current viewport, so it
 * costs nothing to pan or zoom and there is no tiled geometry to run out of.
 *
 * Grid spacing is fixed at one domain unit (matching the default shape sizes elsewhere in the
 * registry, e.g. `GPUNodeEditor`'s ~1.6-unit node boxes) rather than adapting to zoom level — at
 * extreme zoom-out this will alias into moiré noise. Deferred rather than solved: the honest fix is
 * a second, coarser grid that fades in as the fine one fades out, and it isn't worth building until
 * a real user hits it.
 */
export const BACKGROUND_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct BackgroundParams {
  domainMin: vec2f,
  domainMax: vec2f,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: BackgroundParams;

const BG = vec3f(0.035, 0.039, 0.05);
const DOT = vec3f(0.18, 0.20, 0.25);
const CELL = 1.0;
const DOT_RADIUS = 0.035;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let x = mix(params.domainMin.x, params.domainMax.x, uv.x);
  let y = mix(params.domainMin.y, params.domainMax.y, uv.y);
  let fx = fract(x / CELL) - 0.5;
  let fy = fract(y / CELL) - 0.5;
  let d = length(vec2f(fx, fy));
  let color = mix(DOT, BG, smoothstep(DOT_RADIUS, DOT_RADIUS + 0.01, d));
  return vec4f(color, 1.0);
}
`;
