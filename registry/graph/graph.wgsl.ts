/**
 * `GPUGraph`'s two render shaders.
 *
 * Both read node positions **straight from the layout's storage buffer** rather than from
 * CPU-uploaded instance data. That is the structural difference between this component and every
 * other one in the registry: positions are produced on the GPU and consumed on the GPU, so they
 * never round-trip. It is also why the edges cannot use `core`'s `LineLayer` — that primitive owns
 * a CPU-mirrored instance buffer, which is exactly the right design for rules and axes and exactly
 * the wrong one for geometry the GPU is still moving.
 */

/** Shared struct + palette, so the two shaders cannot drift apart on the transform. */
const COMMON = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct GraphParams {
  nodeSizePx: f32,
  edgeWidthPx: f32,
  hoveredNode: i32,
  selectedNode: i32,
}

const PALETTE = array<vec3f, 6>(
  vec3f(0.545, 0.616, 1.0),
  vec3f(0.357, 0.914, 0.725),
  vec3f(0.941, 0.690, 0.447),
  vec3f(0.941, 0.541, 0.541),
  vec3f(0.498, 0.847, 0.941),
  vec3f(0.718, 0.643, 1.0),
);

fn toClip(p: vec2f, viewport: Viewport) -> vec2f {
  return vec2f(p.x * viewport.timeToClip.x + viewport.timeToClip.y,
               p.y * viewport.trackToClip.x + viewport.trackToClip.y);
}
`;

/** Edges: one instanced quad per edge, expanded to a screen-space thick line in the vertex stage —
 * the same technique `LineLayer` uses, applied to endpoints that live in a GPU buffer. */
export const EDGE_WGSL = /* wgsl */ `
${COMMON}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: GraphParams;
@group(0) @binding(2) var<storage, read> positions: array<vec2f>;
@group(0) @binding(3) var<storage, read> edges: array<u32>;

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> @builtin(position) vec4f {
  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];

  let a = toClip(positions[edges[instanceIndex * 2u]], viewport);
  let b = toClip(positions[edges[instanceIndex * 2u + 1u]], viewport);

  let dirClip = b - a;
  var dirPx = vec2f(dirClip.x / viewport.pxSize.x, dirClip.y / viewport.pxSize.y);
  if (dot(dirPx, dirPx) < 1e-12) {
    dirPx = vec2f(1.0, 0.0);
  }
  let unit = normalize(dirPx);
  let normal = vec2f(-unit.y, unit.x);
  let half = max(params.edgeWidthPx, 1.0) * 0.5;
  let offset = vec2f(normal.x * half * viewport.pxSize.x, normal.y * half * viewport.pxSize.y);

  let along = mix(a, b, corner.x);
  return vec4f(along + offset * corner.y, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(0.35, 0.39, 0.5, 0.5);
}
`;

/** Nodes: instanced quads rounded to discs, sized in pixels so they stay legible at any zoom. */
export const NODE_WGSL = /* wgsl */ `
${COMMON}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: GraphParams;
@group(0) @binding(2) var<storage, read> positions: array<vec2f>;
@group(0) @binding(3) var<storage, read> category: array<u32>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) offset: vec2f,
  @location(1) @interpolate(flat) tint: vec3f,
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
  let centre = toClip(positions[instanceIndex], viewport);

  var size = params.nodeSizePx;
  let hovered = i32(instanceIndex) == params.hoveredNode;
  let selected = i32(instanceIndex) == params.selectedNode;
  if (selected) { size = size * 1.5; }
  if (hovered) { size = size * 1.8; }

  var out: VertexOut;
  out.position = vec4f(
    centre.x + corner.x * size * 0.5 * viewport.pxSize.x,
    centre.y + corner.y * size * 0.5 * viewport.pxSize.y,
    0.0,
    1.0,
  );
  out.offset = corner;
  // category is a packed byte array read as u32 words: 4 nodes per word.
  let word = category[instanceIndex / 4u];
  let value = (word >> ((instanceIndex % 4u) * 8u)) & 255u;
  var tint = PALETTE[value % 6u];
  if (selected) { tint = mix(tint, vec3f(1.0), 0.4); }
  if (hovered) { tint = vec3f(1.0); }
  out.tint = tint;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let r = length(in.offset);
  let alpha = 1.0 - smoothstep(0.82, 1.0, r);
  if (alpha <= 0.0) {
    discard;
  }
  return vec4f(in.tint, alpha);
}
`;
