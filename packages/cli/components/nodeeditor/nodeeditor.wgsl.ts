/**
 * Instanced node boxes. Domain-space half-extents (unlike `GPUDepGraph`'s fixed `nodeSizePx`) so
 * boxes scale under zoom the way the rest of a node-flow canvas does.
 */

export const NODEEDITOR_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct Node {
  x: f32,
  y: f32,
  halfWidth: f32,
  halfHeight: f32,
  category: u32,
  flags: u32,
  _pad0: u32,
  _pad1: u32,
}

struct NodeParams {
  hoveredNode: i32,
  opacity: f32,
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: NodeParams;
@group(0) @binding(2) var<storage, read> instances: array<Node>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) offset: vec2f,
  @location(1) @interpolate(flat) category: u32,
  @location(2) @interpolate(flat) state: u32,
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

  var halfW = node.halfWidth;
  var halfH = node.halfHeight;
  var state = 0u;
  // Bit 0 = selected, baked into the instance data by packNodes() — see its doc comment for why
  // multi-select uses a per-instance flag rather than a single-index uniform compare.
  if ((node.flags & 2u) != 0u) {
    state = state | 1u;
    halfW = halfW * 1.04;
    halfH = halfH * 1.08;
  }
  if (i32(instanceIndex) == params.hoveredNode) {
    state = state | 2u;
    halfW = halfW * 1.06;
    halfH = halfH * 1.1;
  }
  // Bit 0 of flags = deleted (soft-delete, see ingest.ts) — zero the box rather than skipping the
  // instance, so index-addressed state (hover/selection by index) never has to special-case it.
  if ((node.flags & 1u) != 0u) {
    halfW = 0.0;
    halfH = 0.0;
  }

  let offsetClip = vec2f(
    corner.x * halfW * viewport.timeToClip.x,
    corner.y * halfH * viewport.trackToClip.x,
  );
  out.position = vec4f(cx + offsetClip.x, cy + offsetClip.y, 0.0, 1.0);
  out.offset = corner;
  out.category = node.category;
  out.state = state;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  // Rounded corners via a per-axis inset superellipse-ish falloff — cheap and good enough at
  // node-box scale (this is not the timeline's fill-rate-bound path).
  let rounding = 0.18;
  let d = abs(in.offset) - vec2f(1.0 - rounding);
  let outside = max(d, vec2f(0.0));
  if (length(outside) > rounding) {
    discard;
  }

  var color = PALETTE[in.category % 6u];
  // Header band across the top ~28% of the box — reads as a title bar without any text.
  let isHeader = in.offset.y < -0.44;
  if (isHeader) {
    color = mix(color, vec3f(0.05, 0.06, 0.09), 0.55);
  } else {
    color = mix(color, vec3f(0.09, 0.10, 0.14), 0.72);
  }

  if ((in.state & 2u) != 0u) {
    color = mix(color, vec3f(1.0), 0.28);
  } else if ((in.state & 1u) != 0u) {
    color = mix(color, vec3f(1.0), 0.16);
  }

  // Thin border, brighter when hovered/selected.
  let edgeDist = max(abs(in.offset.x), abs(in.offset.y));
  var borderStrength = select(0.0, 0.55, edgeDist > 0.86);
  if ((in.state & 2u) != 0u) {
    borderStrength = select(borderStrength, 1.0, edgeDist > 0.82);
  } else if ((in.state & 1u) != 0u) {
    borderStrength = select(borderStrength, 0.85, edgeDist > 0.84);
  }
  color = mix(color, vec3f(0.62, 0.72, 1.0), borderStrength);

  return vec4f(color, params.opacity);
}
`;
