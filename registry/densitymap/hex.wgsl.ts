/**
 * Instanced hex cells: one quad per odd-r cell, shaped in the fragment stage (scatter's disc
 * trick applied to a hex). Colour from the shared colormap LUT × density/max.
 */

/** Placeholder instance stride — centres come from uniforms + `instance_index`, not from bytes. */
export const HEX_INSTANCE_STRIDE = 16;

export const HEX_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct HexParams {
  hexSize: f32,
  minCol: i32,
  minRow: i32,
  cols: u32,
  rows: u32,
  count: u32,
  hoveredIndex: i32,
  opacity: f32,
}

struct Dummy {
  _pad: vec4f,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: HexParams;
@group(0) @binding(2) var<storage, read> instances: array<Dummy>;
@group(0) @binding(3) var<storage, read> density: array<u32>;
@group(0) @binding(4) var<storage, read> maxCount: array<u32>;
@group(0) @binding(5) var<storage, read> lut: array<vec4f>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) offset: vec2f,
  @location(1) @interpolate(flat) cellIndex: u32,
  @location(2) @interpolate(flat) flags: u32,
}

const SQRT3: f32 = 1.73205080757;
const LUT_SIZE: u32 = 256u;

fn axialToPixel(q: f32, r: f32, size: f32) -> vec2f {
  return vec2f(
    size * (SQRT3 * q + (SQRT3 / 2.0) * r),
    size * ((3.0 / 2.0) * r),
  );
}

fn offsetToAxial(col: i32, row: i32) -> vec2f {
  let q = f32(col - (row - (row & 1)) / 2);
  let r = f32(row);
  return vec2f(q, r);
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];

  var out: VertexOut;
  out.cellIndex = instanceIndex;
  out.flags = 0u;

  let count = density[instanceIndex];
  if (count == 0u) {
    out.position = vec4f(0.0, 0.0, 0.0, 0.0);
    out.offset = vec2f(0.0, 0.0);
    return out;
  }

  let col = i32(instanceIndex % params.cols) + params.minCol;
  let row = i32(instanceIndex / params.cols) + params.minRow;
  let axial = offsetToAxial(col, row);
  let center = axialToPixel(axial.x, axial.y, params.hexSize);

  // Bounding quad slightly larger than the hex (apothem = size * √3/2; vertex radius = size).
  let half = params.hexSize * 1.05;
  let world = center + corner * half;
  let clipX = world.x * viewport.timeToClip.x + viewport.timeToClip.y;
  let clipY = world.y * viewport.trackToClip.x + viewport.trackToClip.y;
  out.position = vec4f(clipX, clipY, 0.0, 1.0);
  out.offset = corner;
  if (params.hoveredIndex >= 0 && i32(instanceIndex) == params.hoveredIndex) {
    out.flags = 1u;
  }
  return out;
}

/** Point-in-hex in unit space where the hex is inscribed in the [-1,1] quad (flat-to-flat ≈ √3). */
fn insideHex(p: vec2f) -> bool {
  let q = abs(p);
  // Pointy-top hex in a square of half-extent 1: |x| <= √3/2 and |x|/√3 + |y| <= 1.
  return q.x <= SQRT3 * 0.5 && (q.x / SQRT3 + q.y) <= 1.0;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  if (!insideHex(in.offset)) {
    discard;
  }
  let count = density[in.cellIndex];
  if (count == 0u) {
    discard;
  }
  let peak = max(maxCount[0], 1u);
  let t = clamp(f32(count) / f32(peak), 0.0, 1.0);
  let entry = u32(round(t * f32(LUT_SIZE - 1u)));
  var color = lut[entry];
  // Fade alpha with density as well as stepping the hue. The published sequential ramps
  // (viridis/magma/cividis) all start near-black by design, and a viewport-covering hex grid is
  // mostly *sparse* rather than empty — \`count == 0u\` discards above, but a cell holding one
  // point still maps to the bottom of the ramp. Painting those opaque turns the whole surface into
  // a dark slab regardless of what is behind it. Compositing them instead lets the page show
  // through where there is nothing much to show, which is also what makes this component work on a
  // dark background and a light one without swapping the ramp.
  color.a = color.a * params.opacity * (0.12 + 0.88 * sqrt(t));
  if ((in.flags & 1u) != 0u) {
    color = vec4f(mix(color.rgb, vec3f(0.051, 0.059, 0.078), 0.35), 1.0);
  }
  return color;
}
`;
