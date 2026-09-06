/**
 * Instanced rectangle, ellipse, and point overlays for `GPUAnnotationCanvas`.
 *
 * Rulers, polygon edges, and freehand paths use `LineLayer`; this pass handles the shapes that map
 * naturally to one quad. The instance layout is fixed at 32 bytes for direct `DataView` packing.
 */
export const ANNOTATION_INSTANCE_STRIDE = 32;

export const ANNOTATION_KIND_RECT = 0;
export const ANNOTATION_KIND_ELLIPSE = 1;
export const ANNOTATION_KIND_POINT = 2;

export const ANNOTATION_FLAG_SELECTED = 1 << 0;
export const ANNOTATION_FLAG_HOVERED = 1 << 1;
export const ANNOTATION_COLOR_SHIFT = 8;

export const ANNOTATIONS_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct Annotation {
  kind: u32,
  flags: u32,
  x: f32,
  y: f32,
  w: f32,
  h: f32,
  _pad: vec2f,
}

struct AnnotationParams {
  strokeWidthPx: f32,
  pointSizePx: f32,
  fillOpacity: f32,
  strokeOpacity: f32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: AnnotationParams;
@group(0) @binding(2) var<storage, read> instances: array<Annotation>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) sizePx: vec2f,
  @location(2) @interpolate(flat) kind: u32,
  @location(3) @interpolate(flat) flags: u32,
}

const KIND_RECT: u32 = ${ANNOTATION_KIND_RECT}u;
const KIND_ELLIPSE: u32 = ${ANNOTATION_KIND_ELLIPSE}u;
const KIND_POINT: u32 = ${ANNOTATION_KIND_POINT}u;
const FLAG_SELECTED: u32 = ${ANNOTATION_FLAG_SELECTED}u;
const FLAG_HOVERED: u32 = ${ANNOTATION_FLAG_HOVERED}u;
const COLOR_SHIFT: u32 = ${ANNOTATION_COLOR_SHIFT}u;

const PALETTE = array<vec3f, 8>(
  vec3f(0.059, 0.455, 0.565),
  vec3f(0.427, 0.157, 0.851),
  vec3f(0.055, 0.486, 0.345),
  vec3f(0.663, 0.400, 0.047),
  vec3f(0.753, 0.169, 0.169),
  vec3f(0.761, 0.255, 0.047),
  vec3f(0.114, 0.306, 0.847),
  vec3f(0.051, 0.059, 0.078),
);

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
  let annotation = instances[instanceIndex];
  var out: VertexOut;

  if (annotation.kind == KIND_POINT) {
    let center = vec2f(
      annotation.x * viewport.timeToClip.x + viewport.timeToClip.y,
      annotation.y * viewport.trackToClip.x + viewport.trackToClip.y,
    );
    let offset = corner * 2.0 - vec2f(1.0);
    out.position = vec4f(
      center + offset * params.pointSizePx * 0.5 * viewport.pxSize,
      0.0,
      1.0,
    );
    out.sizePx = vec2f(params.pointSizePx);
  } else {
    let image = vec2f(
      annotation.x + corner.x * annotation.w,
      annotation.y + corner.y * annotation.h,
    );
    out.position = vec4f(
      image.x * viewport.timeToClip.x + viewport.timeToClip.y,
      image.y * viewport.trackToClip.x + viewport.trackToClip.y,
      0.0,
      1.0,
    );
    out.sizePx = abs(vec2f(
      annotation.w * viewport.timeToClip.x / viewport.pxSize.x,
      annotation.h * viewport.trackToClip.x / viewport.pxSize.y,
    ));
  }

  out.local = corner * 2.0 - vec2f(1.0);
  out.kind = annotation.kind;
  out.flags = annotation.flags;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  var distanceToEdgePx: f32;
  if (in.kind == KIND_RECT) {
    let edge = (vec2f(1.0) - abs(in.local)) * in.sizePx * 0.5;
    distanceToEdgePx = min(edge.x, edge.y);
  } else if (in.kind == KIND_ELLIPSE) {
    let halfExtents = max(in.sizePx * 0.5, vec2f(1.0));
    let r = length(in.local);
    let scalePx = select(
      min(halfExtents.x, halfExtents.y),
      length(halfExtents * in.local / r),
      r > 1e-5,
    );
    distanceToEdgePx = (1.0 - r) * scalePx;
  } else {
    let radiusPx = max(min(in.sizePx.x, in.sizePx.y) * 0.5, 1.0);
    distanceToEdgePx = (1.0 - length(in.local)) * radiusPx;
  }

  if (distanceToEdgePx < 0.0) {
    discard;
  }

  var color = PALETTE[(in.flags >> COLOR_SHIFT) & 7u];
  var strokeWidth = max(params.strokeWidthPx, 1.0);
  if ((in.flags & FLAG_SELECTED) != 0u) {
    color = mix(color, vec3f(0.051, 0.059, 0.078), 0.45);
    strokeWidth = strokeWidth * 1.5;
  }
  if ((in.flags & FLAG_HOVERED) != 0u) {
    color = mix(color, vec3f(0.051, 0.059, 0.078), 0.65);
  }

  let isStroke = distanceToEdgePx <= strokeWidth || in.kind == KIND_POINT;
  let opacity = select(params.fillOpacity, params.strokeOpacity, isStroke);
  let coverage = clamp(distanceToEdgePx, 0.0, 1.0) * opacity;
  return vec4f(color, coverage);
}
`;
