/**
 * `GPUNetworkTopology` node and edge render shaders.
 *
 * Both consume positions directly from the force-layout storage buffer.
 */
const COMMON = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct TopologyParams {
  nodeSizePx: f32,
  edgeWidthPx: f32,
  selectedNode: i32,
  time: f32,
  pulseSpeed: f32,
}

const KIND_PALETTE = array<vec3f, 5>(
  vec3f(0.545, 0.616, 1.0),
  vec3f(0.357, 0.914, 0.725),
  vec3f(0.941, 0.690, 0.447),
  vec3f(0.941, 0.541, 0.541),
  vec3f(0.498, 0.847, 0.941),
);

fn toClip(p: vec2f, viewport: Viewport) -> vec2f {
  return vec2f(p.x * viewport.timeToClip.x + viewport.timeToClip.y,
               p.y * viewport.trackToClip.x + viewport.trackToClip.y);
}
`;

/** Edges: one instanced quad per edge, expanded into a screen-space thick line. */
export const EDGE_WGSL = /* wgsl */ `
${COMMON}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: TopologyParams;
@group(0) @binding(2) var<storage, read> positions: array<vec2f>;
@group(0) @binding(3) var<storage, read> edges: array<u32>;
@group(0) @binding(4) var<storage, read> edgeHealth: array<f32>;
@group(0) @binding(5) var<storage, read> edgeTraffic: array<f32>;

struct EdgeVertexOut {
  @builtin(position) position: vec4f,
  @location(0) along: f32,
  @location(1) @interpolate(flat) health: f32,
  @location(2) @interpolate(flat) traffic: f32,
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> EdgeVertexOut {
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
  let traffic = edgeTraffic[instanceIndex];
  let half = max(params.edgeWidthPx * (0.6 + traffic * 1.8), 1.0) * 0.5;
  let offset = vec2f(normal.x * half * viewport.pxSize.x, normal.y * half * viewport.pxSize.y);

  var out: EdgeVertexOut;
  out.position = vec4f(mix(a, b, corner.x) + offset * corner.y, 0.0, 1.0);
  out.along = corner.x;
  out.health = edgeHealth[instanceIndex];
  out.traffic = traffic;
  return out;
}

@fragment
fn fs_main(in: EdgeVertexOut) -> @location(0) vec4f {
  let healthy = vec3f(0.35, 0.75, 0.45);
  let mid = vec3f(0.90, 0.70, 0.30);
  let sick = vec3f(0.90, 0.35, 0.30);
  var color = mix(sick, mid, smoothstep(0.0, 0.5, in.health));
  color = mix(color, healthy, smoothstep(0.5, 1.0, in.health));
  let pulse = fract(in.along + params.time * params.pulseSpeed * max(in.traffic, 0.05));
  var glow = smoothstep(0.55, 0.75, pulse) * (0.25 + 0.75 * in.traffic);
  if (in.health < 0.15) {
    glow = 0.0;
  }
  color = mix(color, vec3f(1.0), glow * 0.45);
  let alpha = 0.35 + 0.45 * in.traffic;
  return vec4f(color, alpha);
}
`;

/** Nodes: instanced rounded quads sized and tinted by topology kind and status. */
export const NODE_WGSL = /* wgsl */ `
${COMMON}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: TopologyParams;
@group(0) @binding(2) var<storage, read> positions: array<vec2f>;
@group(0) @binding(3) var<storage, read> kind: array<u32>;
@group(0) @binding(4) var<storage, read> status: array<u32>;

struct NodeVertexOut {
  @builtin(position) position: vec4f,
  @location(0) offset: vec2f,
  @location(1) @interpolate(flat) tint: vec3f,
  @location(2) @interpolate(flat) opacity: f32,
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> NodeVertexOut {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let centre = toClip(positions[instanceIndex], viewport);

  let kindWord = kind[instanceIndex / 4u];
  let kindValue = (kindWord >> ((instanceIndex % 4u) * 8u)) & 255u;
  let statusWord = status[instanceIndex / 4u];
  let statusValue = (statusWord >> ((instanceIndex % 4u) * 8u)) & 255u;

  var kindScale = 1.0;
  if (kindValue == 0u) {
    kindScale = 1.8;
  } else if (kindValue == 1u) {
    kindScale = 1.5;
  } else if (kindValue == 2u) {
    kindScale = 1.2;
  } else if (kindValue == 4u) {
    kindScale = 1.1;
  }

  let selected = i32(instanceIndex) == params.selectedNode;
  var size = params.nodeSizePx * kindScale;
  if (selected) {
    size = size * 1.5;
  }

  var tint = KIND_PALETTE[kindValue % 5u];
  var opacity = 1.0;
  if (statusValue == 1u) {
    tint = mix(tint, vec3f(0.90, 0.70, 0.30), 0.55);
  } else if (statusValue == 2u) {
    tint = mix(tint, vec3f(0.90, 0.35, 0.30), 0.75);
    opacity = 0.55;
  }
  if (selected) {
    tint = mix(tint, vec3f(1.0), 0.4);
  }

  var out: NodeVertexOut;
  out.position = vec4f(
    centre.x + corner.x * size * 0.5 * viewport.pxSize.x,
    centre.y + corner.y * size * 0.5 * viewport.pxSize.y,
    0.0,
    1.0,
  );
  out.offset = corner;
  out.tint = tint;
  out.opacity = opacity;
  return out;
}

@fragment
fn fs_main(in: NodeVertexOut) -> @location(0) vec4f {
  let alpha = (1.0 - smoothstep(0.82, 1.0, length(in.offset))) * in.opacity;
  if (alpha <= 0.0) {
    discard;
  }
  return vec4f(in.tint, alpha);
}
`;
