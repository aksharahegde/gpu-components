/**
 * `LineLayer`'s built-in shader. Kept as a TS template string for the same reason
 * `registry/timeline/*.wgsl.ts` are — see PLAN.md §13.2's drift note, which records the open
 * decision about migrating the whole repo to real `.wgsl` files. This is the first WGSL to live in
 * `packages/core`, so it is also the first thing that migration will have to move.
 *
 * Exported (rather than inlined into `lineLayer.ts`) so a consumer that needs different colouring
 * can fork it, keep the `LineInstance` layout, and pass the result as `LineLayerOptions.shader` —
 * the same "own the shader" escape hatch PLAN.md §17.2/§18 gives registry components, applied to a
 * core primitive.
 */
export const LINE_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

// 32 bytes — must match LINE_INSTANCE_STRIDE and writeLine()'s field order exactly. \`_pad\` is
// explicit rather than implied so the WGSL array stride and the TypeScript stride agree by
// construction instead of by coincidence of alignment rules.
struct LineInstance {
  x0: f32,
  y0: f32,
  x1: f32,
  y1: f32,
  widthPx: f32,
  color: u32,
  flags: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<storage, read> instances: array<LineInstance>;

const FLAG_CLIP_X: u32 = 1u;
const FLAG_CLIP_Y: u32 = 2u;

// Endpoints are in the caller's domain (time on x, track row on y) unless the matching flag says
// they are already clip-space. Clip-space passthrough is what lets one instance span the full
// height or width of the surface without knowing the current domain — the axis-rule case.
fn toClipX(x: f32, flags: u32) -> f32 {
  if ((flags & FLAG_CLIP_X) != 0u) { return x; }
  return x * viewport.timeToClip.x + viewport.timeToClip.y;
}

fn toClipY(y: f32, flags: u32) -> f32 {
  if ((flags & FLAG_CLIP_Y) != 0u) { return y; }
  return y * viewport.trackToClip.x + viewport.trackToClip.y;
}

fn unpackRgba8(packed: u32) -> vec4f {
  return vec4f(
    f32((packed >> 24u) & 255u),
    f32((packed >> 16u) & 255u),
    f32((packed >> 8u) & 255u),
    f32(packed & 255u),
  ) / 255.0;
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) color: vec4f,
}

const MIN_WIDTH_PX: f32 = 1.0;

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
  let line = instances[instanceIndex];

  let p0 = vec2f(toClipX(line.x0, line.flags), toClipY(line.y0, line.flags));
  let p1 = vec2f(toClipX(line.x1, line.flags), toClipY(line.y1, line.flags));

  // Expand to a screen-space thick line in the vertex stage (PLAN.md §12.1's second primitive):
  // work out the direction in *pixels* so the thickness is uniform regardless of the surface's
  // aspect ratio, then convert the normal offset back to clip units.
  let dirClip = p1 - p0;
  var dirPx = vec2f(dirClip.x / viewport.pxSize.x, dirClip.y / viewport.pxSize.y);
  // A zero-length line would make normalize() produce NaN, and a NaN vertex position blanks
  // geometry (PLAN.md §24.2's "never NaN-propagate" rule, applied at the point of division rather
  // than trusted to the caller). Degenerate lines fall back to a horizontal direction, which draws
  // a \`widthPx\`-tall dot at the endpoint — visible and finite, rather than absent.
  if (dot(dirPx, dirPx) < 1e-12) {
    dirPx = vec2f(1.0, 0.0);
  }
  let unitPx = normalize(dirPx);
  let normalPx = vec2f(-unitPx.y, unitPx.x);

  let halfWidth = max(line.widthPx, MIN_WIDTH_PX) * 0.5;
  let offsetClip = vec2f(
    normalPx.x * halfWidth * viewport.pxSize.x,
    normalPx.y * halfWidth * viewport.pxSize.y,
  );

  // corner.x picks the endpoint, corner.y picks the side of the line.
  let along = mix(p0, p1, corner.x);
  let position = along + offsetClip * mix(-1.0, 1.0, corner.y);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.color = unpackRgba8(line.color);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return in.color;
}
`;
