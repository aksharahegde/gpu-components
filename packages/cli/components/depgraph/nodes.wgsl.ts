/**
 * Instanced dependency-graph nodes — discs like scatter, positions from Sugiyama layout.
 */

export const NODES_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct Node {
  x: f32,
  y: f32,
  category: u32,
  flags: u32,
}

struct NodeParams {
  nodeSizePx: f32,
  hoveredNode: i32,
  selectedNode: i32,
  opacity: f32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: NodeParams;
@group(0) @binding(2) var<storage, read> instances: array<Node>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) offset: vec2f,
  @location(1) @interpolate(flat) category: u32,
  @location(2) @interpolate(flat) flags: u32,
}

const PALETTE = array<vec3f, 6>(
  vec3f(0.545, 0.616, 1.0),
  vec3f(0.357, 0.914, 0.725),
  vec3f(0.941, 0.690, 0.447),
  vec3f(0.941, 0.541, 0.541),
  vec3f(0.498, 0.847, 0.941),
  vec3f(0.718, 0.643, 1.0),
);

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
  let node = instances[instanceIndex];

  var out: VertexOut;
  let cx = node.x * viewport.timeToClip.x + viewport.timeToClip.y;
  let cy = node.y * viewport.trackToClip.x + viewport.trackToClip.y;

  var size = params.nodeSizePx;
  if ((node.flags & 1u) != 0u) { size = size * 1.25; }
  if (i32(instanceIndex) == params.selectedNode) { size = size * 1.35; }
  if (i32(instanceIndex) == params.hoveredNode) { size = size * 1.55; }

  let offsetClip = vec2f(
    corner.x * size * 0.5 * viewport.pxSize.x,
    corner.y * size * 0.5 * viewport.pxSize.y,
  );
  out.position = vec4f(cx + offsetClip.x, cy + offsetClip.y, 0.0, 1.0);
  out.offset = corner;
  out.category = node.category;
  out.flags = node.flags;
  if (i32(instanceIndex) == params.hoveredNode) { out.flags = out.flags | 4u; }
  if (i32(instanceIndex) == params.selectedNode) { out.flags = out.flags | 8u; }
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  if (dot(in.offset, in.offset) > 1.0) {
    discard;
  }
  var color = PALETTE[in.category % 6u];
  if ((in.flags & 1u) != 0u) {
    color = mix(color, vec3f(1.0), 0.2);
  }
  if ((in.flags & 8u) != 0u) {
    color = mix(color, vec3f(1.0), 0.35);
  }
  if ((in.flags & 4u) != 0u) {
    color = mix(color, vec3f(1.0), 0.45);
  }
  return vec4f(color, params.opacity);
}
`;
