/**
 * Instanced connection-port dots — one input + one output per node. Pixel-constant radius (unlike
 * the node boxes, which scale with zoom): a grab target should stay a consistent, clickable screen
 * size the way it does in Figma/Blender, since it has no content of its own to scale.
 */

export const PORTS_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct Port {
  x: f32,
  y: f32,
  kind: u32, // 0 = input, 1 = output
  flags: u32, // bit0 = owner node deleted, bit1 = hovered drop target
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(2) var<storage, read> instances: array<Port>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) offset: vec2f,
  @location(1) @interpolate(flat) kind: u32,
  @location(2) @interpolate(flat) flags: u32,
}

const RADIUS_PX = 5.0;

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
  let port = instances[instanceIndex];

  var out: VertexOut;
  let cx = port.x * viewport.timeToClip.x + viewport.timeToClip.y;
  let cy = port.y * viewport.trackToClip.x + viewport.trackToClip.y;

  var radius = RADIUS_PX;
  if ((port.flags & 1u) != 0u) { radius = 0.0; } // owner node deleted — draw nothing
  if ((port.flags & 2u) != 0u) { radius = radius * 1.6; } // hovered drop target

  let offsetClip = vec2f(corner.x * radius * viewport.pxSize.x, corner.y * radius * viewport.pxSize.y);
  out.position = vec4f(cx + offsetClip.x, cy + offsetClip.y, 0.0, 1.0);
  out.offset = corner;
  out.kind = port.kind;
  out.flags = port.flags;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  if (dot(in.offset, in.offset) > 1.0) {
    discard;
  }
  // Input ports read cool blue, output ports warm amber — a consistent left-in/right-out visual
  // grammar across every node.
  var color = select(vec3f(0.60, 0.78, 1.0), vec3f(1.0, 0.74, 0.42), in.kind == 1u);
  if ((in.flags & 2u) != 0u) {
    color = mix(color, vec3f(1.0), 0.5);
  }
  return vec4f(color, 1.0);
}
`;
