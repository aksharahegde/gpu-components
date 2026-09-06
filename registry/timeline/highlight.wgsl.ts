/**
 * The hover/selection overlay shader (PLAN.md §12.2's "overlay" pass, drawn as a second `draw()`
 * call within `TimelineComponent`'s one render pass — see its `plan()`). Reuses `timeline.wgsl.ts`'s
 * viewport transform math (duplicated, not shared, for v1 — see that file's note on why a shared
 * WGSL module package is deferred) with a larger row fraction, so a highlighted span reads as a
 * halo around the real span rather than an exact overlap.
 */
export const HIGHLIGHT_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

/** \`colorIndex\` is repurposed here as the highlight kind: 0 = hover, 1 = selected. */
struct SpanInstance {
  start: f32,
  duration: f32,
  track: u32,
  colorIndex: u32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<storage, read> instances: array<SpanInstance>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) kind: u32,
}

const ROW_FRACTION: f32 = 0.85;
const MIN_WIDTH_PX: f32 = 1.5;

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
  let span = instances[instanceIndex];

  let xStart = span.start * viewport.timeToClip.x + viewport.timeToClip.y;
  var xEnd = (span.start + span.duration) * viewport.timeToClip.x + viewport.timeToClip.y;
  let minWidth = viewport.pxSize.x * MIN_WIDTH_PX;
  if (xEnd - xStart < minWidth) {
    xEnd = xStart + minWidth;
  }

  let rowCenter = f32(span.track) * viewport.trackToClip.x + viewport.trackToClip.y;
  let halfRow = abs(viewport.trackToClip.x) * 0.5 * ROW_FRACTION;

  let x = mix(xStart, xEnd, corner.x);
  let y = mix(rowCenter + halfRow, rowCenter - halfRow, corner.y);

  var out: VertexOut;
  out.position = vec4f(x, y, 0.0, 1.0);
  out.kind = span.colorIndex;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  if (in.kind == 1u) {
    return vec4f(0.663, 0.400, 0.047, 0.45); // selected: amber wash
  }
  // Hover: an ink wash. A white wash is the dark-surface idiom and is invisible here.
  return vec4f(0.051, 0.059, 0.078, 0.16);
}
`;
