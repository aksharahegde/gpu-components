/**
 * One positioned, textured quad — a page. Unlike `InstancedQuadLayer` (one shared shader, many
 * instances in a storage buffer) or `RasterLayer` (one full-screen effect), a page slot is neither:
 * each resident page has its own texture, so it needs its own bind group, and there are only ever a
 * handful of them resident at once (`PdfViewerComponent`'s pool). One `draw()` per slot, each with
 * its own tiny per-slot uniform for where the page sits in document space.
 */
export const PAGE_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct PageRect {
  x: f32,
  y: f32,
  w: f32,
  h: f32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> rect: PageRect;
@group(0) @binding(2) var pageTexture: texture_2d<f32>;
@group(0) @binding(3) var pageSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let world = vec2f(rect.x + corner.x * rect.w, rect.y + corner.y * rect.h);

  var out: VertexOut;
  out.position = vec4f(
    world.x * viewport.timeToClip.x + viewport.timeToClip.y,
    world.y * viewport.trackToClip.x + viewport.trackToClip.y,
    0.0,
    1.0,
  );
  out.uv = corner;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return textureSample(pageTexture, pageSampler, in.uv);
}
`;
