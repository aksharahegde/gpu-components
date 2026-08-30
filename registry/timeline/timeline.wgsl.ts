/**
 * Kept as a plain TS string, not a `.wgsl` file, for v1: `vgpu`'s WGSL module system (imports, DCE,
 * a bundler loader) needs its Vite/webpack plugin wired into the consuming app, which is real build
 * tooling this milestone doesn't need yet with exactly one shader and no shared WGSL modules to pull
 * in (PLAN.md §10.4 defers the "shared WGSL module package" itself, for the same reason). A template
 * string works identically under Vite, Node, and the mock-harness tests with zero extra tooling.
 * Revisit once a second component needs to share WGSL with this one.
 */
export const TIMELINE_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct SpanInstance {
  start: f32,
  duration: f32,
  track: u32,
  colorIndex: u32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<storage, read> instances: array<SpanInstance>;
// Written by cull.wgsl.ts's compute pass: the indices of spans visible in the current viewport,
// compacted so \`instanceIndex\` here walks 0..visibleCount, not 0..totalSpanCount.
@group(0) @binding(2) var<storage, read> visibleIndices: array<u32>;
// Written by brushSelect.wgsl.ts's compute pass — 1 bit per span, packed 32/word. Bound whenever
// TimelineComponent exists (not just during an active brush); all-zero when no brush is active, so
// isSelected() is always safe to call.
@group(0) @binding(3) var<storage, read> selectionMask: array<u32>;

fn isSelected(i: u32) -> bool {
  let word = selectionMask[i / 32u];
  let bit = 1u << (i % 32u);
  return (word & bit) != 0u;
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) colorIndex: u32,
  @location(1) @interpolate(flat) spanIndex: u32,
}

const ROW_FRACTION: f32 = 0.7;
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
  let spanIndex = visibleIndices[instanceIndex];
  let span = instances[spanIndex];

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
  out.colorIndex = span.colorIndex;
  out.spanIndex = spanIndex;
  return out;
}

const PALETTE = array<vec4f, 6>(
  vec4f(0.545, 0.616, 1.0, 1.0),
  vec4f(0.357, 0.914, 0.725, 1.0),
  vec4f(0.941, 0.690, 0.447, 1.0),
  vec4f(0.941, 0.541, 0.541, 1.0),
  vec4f(0.498, 0.847, 0.941, 1.0),
  vec4f(0.718, 0.643, 1.0, 1.0),
);

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  var color = PALETTE[in.colorIndex % 6u];
  if (isSelected(in.spanIndex)) {
    // Brighten toward white — visually distinct from the separate hover/click highlight
    // (highlight.wgsl.ts), which outlines rather than tints.
    color = mix(color, vec4f(1.0, 1.0, 1.0, 1.0), 0.4);
  }
  return color;
}
`;
