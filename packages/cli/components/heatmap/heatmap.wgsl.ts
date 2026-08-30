/**
 * `GPUHeatmap`'s render pass: a full-screen `effect()` fragment shader through `core`'s
 * `RasterLayer` (PLAN.md §12.1's third primitive), reading the value matrix, the GPU-computed
 * range, and the colormap LUT directly from storage buffers.
 *
 * Reuse note for the Phase 5 architecture test: this binds `core`'s `Viewport` struct unchanged and
 * inverts the *same* scale/offset mapping `viewportUniforms()` produces — `timeToClip` carries the
 * column domain and `trackToClip` the row domain. That works, and it is also the clearest statement
 * of the naming problem: nothing here is a "time" or a "track".
 *
 * Kept as a TS template string for the same reason every other shader in this repo is — see
 * PLAN.md §13.2's drift note on the unbuilt `.wgsl` toolchain.
 */
export const HEATMAP_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct Grid {
  rows: u32,
  cols: u32,
  // How many cells this pixel covers per axis, clamped CPU-side to SAMPLE_CAP. Sub-pixel cells are
  // the zoomed-out case: without this, one cell per pixel is sampled and the rest of the data is
  // invisible — the heatmap equivalent of the Timeline's LOD problem.
  sampleX: u32,
  sampleY: u32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> grid: Grid;
@group(0) @binding(2) var<storage, read> values: array<f32>;
// [min, max] from the reduction passes. Read on the GPU; never round-trips to the CPU (§5, gate 4).
@group(0) @binding(3) var<storage, read> range: array<f32>;
@group(0) @binding(4) var<storage, read> lut: array<vec4f>;

const LUT_MAX: f32 = 255.0;

fn sampleLut(t: f32) -> vec4f {
  let clamped = clamp(t, 0.0, 1.0);
  let position = clamped * LUT_MAX;
  let lo = u32(floor(position));
  let hi = min(lo + 1u, u32(LUT_MAX));
  // Interpolate between LUT entries so a smooth field does not band at 256 steps.
  return mix(lut[lo], lut[hi], position - f32(lo));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // uv is top-origin [0,1]; clip is [-1,1] with +1 at the top. Invert core's forward mapping.
  let clipX = 2.0 * uv.x - 1.0;
  let clipY = 1.0 - 2.0 * uv.y;

  let colF = (clipX - viewport.timeToClip.y) / viewport.timeToClip.x;
  let rowF = (clipY - viewport.trackToClip.y) / viewport.trackToClip.x;

  let col0 = i32(floor(colF));
  let row0 = i32(round(rowF));
  if (col0 < 0 || row0 < 0 || u32(col0) >= grid.cols || u32(row0) >= grid.rows) {
    discard;
  }

  // Aggregate the cells this pixel covers, taking the maximum — for a density-like matrix, max
  // preserves the presence of a hot cell that averaging would wash out. Bounded by sampleX/sampleY,
  // which the CPU already clamped, so this loop can never run away on hostile data (§24.2).
  var best = 0.0;
  var found = false;
  for (var dy: u32 = 0u; dy < grid.sampleY; dy = dy + 1u) {
    let r = row0 + i32(dy);
    if (r < 0 || u32(r) >= grid.rows) { continue; }
    for (var dx: u32 = 0u; dx < grid.sampleX; dx = dx + 1u) {
      let c = col0 + i32(dx);
      if (c < 0 || u32(c) >= grid.cols) { continue; }
      let v = values[u32(r) * grid.cols + u32(c)];
      // NaN holes are excluded here exactly as they are from the range reduction: v == v is false
      // only for NaN, which is the standard WGSL idiom (there is no isnan()).
      if (v == v) {
        if (!found || v > best) { best = v; }
        found = true;
      }
    }
  }
  if (!found) {
    discard;
  }

  let lo = range[0];
  let hi = range[1];
  let span = max(hi - lo, 1e-20);
  return sampleLut((best - lo) / span);
}
`;
