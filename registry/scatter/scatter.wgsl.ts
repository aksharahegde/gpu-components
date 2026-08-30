/**
 * `GPUScatter`'s point pass: one instanced quad per point, rounded to a disc in the fragment stage.
 *
 * The whole component is §5.1's first bullet — "instanced primitive rendering with per-instance
 * attributes in a storage buffer" — with nothing else in the way. That is why §6.2 scores it 10 on
 * demonstrable perf delta: there is no text budget, no grid semantics and no LOD subtlety obscuring
 * the comparison. One draw call, N points, and the CPU touches none of them.
 *
 * Point size is in *pixels*, constant under zoom, which is what makes a scatter readable when you
 * zoom in — and is the same screen-space trick `LineLayer` uses for thickness.
 */
export const SCATTER_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct Point {
  x: f32,
  y: f32,
  category: u32,
  _pad: u32,
}

struct ScatterParams {
  pointSizePx: f32,
  // 0 = draw every point; >0 keeps only points whose category matches, which turns filtering into
  // a uniform write rather than a buffer rebuild (§5, gate 3).
  categoryFilter: i32,
  hoveredIndex: i32,
  opacity: f32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: ScatterParams;
@group(0) @binding(2) var<storage, read> instances: array<Point>;
// Written by a brush compute pass — 1 bit per point, packed 32 per word, same model as the
// Timeline's selection mask. All-zero when nothing is selected, so isSelected() is always safe.
@group(0) @binding(3) var<storage, read> selectionMask: array<u32>;

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

fn isSelected(i: u32) -> bool {
  let word = selectionMask[i / 32u];
  return (word & (1u << (i % 32u))) != 0u;
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
  let point = instances[instanceIndex];

  var out: VertexOut;

  // Filtered-out points collapse to a degenerate quad rather than being culled on the CPU: the
  // data never moves, only a uniform changes.
  if (params.categoryFilter > 0 && i32(point.category) + 1 != params.categoryFilter) {
    out.position = vec4f(0.0, 0.0, 0.0, 0.0);
    out.offset = vec2f(0.0);
    out.category = point.category;
    out.flags = 0u;
    return out;
  }

  let cx = point.x * viewport.timeToClip.x + viewport.timeToClip.y;
  let cy = point.y * viewport.trackToClip.x + viewport.trackToClip.y;

  let selected = isSelected(instanceIndex);
  let hovered = i32(instanceIndex) == params.hoveredIndex;
  var size = params.pointSizePx;
  if (selected) { size = size * 1.4; }
  if (hovered) { size = size * 1.8; }

  // Half-size offset in clip units — pxSize is clip-per-pixel, so this keeps discs circular
  // regardless of the surface's aspect ratio.
  let offsetClip = vec2f(corner.x * size * 0.5 * viewport.pxSize.x, corner.y * size * 0.5 * viewport.pxSize.y);

  out.position = vec4f(cx + offsetClip.x, cy + offsetClip.y, 0.0, 1.0);
  out.offset = corner;
  out.category = point.category;
  out.flags = select(0u, 1u, selected) | select(0u, 2u, hovered);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  // Round the quad into a disc. A soft edge over roughly one pixel of the quad's half-width keeps
  // dense clouds from aliasing into a moiré.
  let r = length(in.offset);
  let alpha = 1.0 - smoothstep(0.85, 1.0, r);
  if (alpha <= 0.0) {
    discard;
  }

  var color = PALETTE[in.category % 6u];
  if ((in.flags & 1u) != 0u) { color = mix(color, vec3f(1.0), 0.45); }
  if ((in.flags & 2u) != 0u) { color = vec3f(1.0); }

  return vec4f(color, alpha * params.opacity);
}
`;
