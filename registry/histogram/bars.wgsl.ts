/**
 * Instanced histogram bars: one quad per bin, height from count/max.
 * X uses the shared viewport (value domain). Y uses [0,1] with yContinuous where
 * 0 is the top of the canvas and 1 the bottom — bars grow upward from y=1.
 */

/** Placeholder instance stride — layout comes from uniforms + instance_index. */
export const BAR_INSTANCE_STRIDE = 16;

export const BARS_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct BarParams {
  domainMin: f32,
  binWidth: f32,
  binCount: u32,
  hoveredBin: i32,
  gapFrac: f32,
  opacity: f32,
  _pad0: f32,
  _pad1: f32,
}

struct Dummy {
  _pad: vec4f,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: BarParams;
@group(0) @binding(2) var<storage, read> instances: array<Dummy>;
@group(0) @binding(3) var<storage, read> bins: array<u32>;
@group(0) @binding(4) var<storage, read> maxCount: array<u32>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) flags: u32,
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  var out: VertexOut;
  out.flags = 0u;

  let count = bins[instanceIndex];
  if (count == 0u) {
    out.position = vec4f(0.0, 0.0, 0.0, 0.0);
    return out;
  }

  let peak = max(maxCount[0], 1u);
  let height = f32(count) / f32(peak);
  let inset = params.binWidth * clamp(params.gapFrac, 0.0, 0.45) * 0.5;
  let x0 = params.domainMin + f32(instanceIndex) * params.binWidth + inset;
  let x1 = params.domainMin + f32(instanceIndex + 1u) * params.binWidth - inset;
  // yContinuous [0,1]: 0 = top, 1 = bottom. Bars grow from the bottom edge upward.
  let yLo = 1.0 - height;
  let yHi = 1.0;
  let clipX = mix(
    x0 * viewport.timeToClip.x + viewport.timeToClip.y,
    x1 * viewport.timeToClip.x + viewport.timeToClip.y,
    corner.x,
  );
  let clipY = mix(
    yLo * viewport.trackToClip.x + viewport.trackToClip.y,
    yHi * viewport.trackToClip.x + viewport.trackToClip.y,
    corner.y,
  );
  out.position = vec4f(clipX, clipY, 0.0, 1.0);
  if (params.hoveredBin >= 0 && i32(instanceIndex) == params.hoveredBin) {
    out.flags = 1u;
  }
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  var color = vec3f(0.545, 0.616, 1.0);
  if ((in.flags & 1u) != 0u) {
    color = mix(color, vec3f(1.0), 0.35);
  }
  return vec4f(color, params.opacity);
}
`;
