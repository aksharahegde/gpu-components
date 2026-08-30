/**
 * `GPUDataGrid`'s cell-chrome pass: zebra striping, hover/selection, and **per-cell conditional
 * formatting** — one full-screen `effect()` through `core`'s `RasterLayer`.
 *
 * Why a raster pass rather than one instanced quad per cell: a grid's backgrounds are a *field*,
 * exactly like `GPUHeatmap`'s, so the same primitive fits and costs one draw instead of ~2,400
 * instances that would have to be re-uploaded on every scroll. This is the third distinct component
 * to reach for `RasterLayer`, and the second to reach for it in a way its author did not
 * specifically anticipate.
 *
 * This shader draws **no text**. Per `spikes/grid-text-budget.md`, cell text is a Canvas2D layer
 * over this surface — measured at 2.9ms per frame for 2,400 cells, against a glyph atlas that would
 * have been the largest schedule risk in the phase.
 */
export const GRID_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct GridParams {
  rowCount: u32,
  columnCount: u32,
  numericColumnCount: u32,
  hoveredRow: i32,
  selectedRow: i32,
  // Pixel x of the grid's left edge relative to the scrolled viewport, and the total grid width,
  // so the fragment shader can find the column under a pixel without a per-column loop.
  scrollX: f32,
  totalWidth: f32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: GridParams;
@group(0) @binding(2) var<storage, read> values: array<f32>;
// [min, max] per numeric column, packed pairwise.
@group(0) @binding(3) var<storage, read> ranges: array<f32>;
// Left pixel offset of every column, plus a final entry holding the total width — a prefix sum
// computed once on the CPU, because column widths are layout and layout stays on the CPU (§5.2).
@group(0) @binding(4) var<storage, read> columnOffsets: array<f32>;
// -1 for text columns, else the column's index within \`values\`.
@group(0) @binding(5) var<storage, read> numericIndex: array<i32>;

const ROW_EVEN = vec3f(0.055, 0.063, 0.075);
const ROW_ODD  = vec3f(0.075, 0.086, 0.102);
const HOVER    = vec3f(0.16, 0.18, 0.23);
const SELECTED = vec3f(0.20, 0.24, 0.34);
/** Conditional formatting ramp: a cool-to-warm wash laid *under* the text, kept low-contrast so
 * the Canvas2D text on top stays readable (§21.2's WCAG note on text-on-fill). */
const HEAT_LO = vec3f(0.10, 0.16, 0.28);
const HEAT_HI = vec3f(0.42, 0.24, 0.16);

/** Binary search over the column prefix sum: log2(columns) steps instead of a linear scan. */
fn columnAt(x: f32) -> i32 {
  var lo: i32 = 0;
  var hi: i32 = i32(params.columnCount) - 1;
  var found: i32 = -1;
  loop {
    if (lo > hi) { break; }
    let mid = (lo + hi) / 2;
    let start = columnOffsets[mid];
    let end = columnOffsets[mid + 1];
    if (x < start) { hi = mid - 1; }
    else if (x >= end) { lo = mid + 1; }
    else { found = mid; break; }
  }
  return found;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // Row comes from the viewport's y mapping — the same row range the Timeline and Heatmap use.
  let clipY = 1.0 - 2.0 * uv.y;
  let rowF = (clipY - viewport.trackToClip.y) / viewport.trackToClip.x;
  let row = i32(round(rowF));
  if (row < 0 || u32(row) >= params.rowCount) {
    discard;
  }

  // Columns are pixel-width, not a uniform domain, so x maps through the prefix sum rather than
  // through timeToClip. Horizontal scroll is a pixel offset for the same reason.
  // pxSize.x is clip units per CSS pixel (2 / width), so 2 / pxSize.x recovers the surface width.
  let x = params.scrollX + uv.x * (2.0 / viewport.pxSize.x);
  let column = columnAt(x);
  if (column < 0) {
    discard;
  }

  var color = select(ROW_EVEN, ROW_ODD, (row % 2) == 1);

  // Conditional formatting: numeric cells are washed by where the value sits in its column range.
  let numeric = numericIndex[column];
  if (numeric >= 0 && params.numericColumnCount > 0u) {
    let value = values[u32(row) * params.numericColumnCount + u32(numeric)];
    if (value == value) {   // not NaN
      let lo = ranges[u32(numeric) * 2u];
      let hi = ranges[u32(numeric) * 2u + 1u];
      let t = clamp((value - lo) / max(hi - lo, 1e-20), 0.0, 1.0);
      color = mix(color, mix(HEAT_LO, HEAT_HI, t), 0.55);
    }
  }

  if (row == params.selectedRow) { color = mix(color, SELECTED, 0.7); }
  else if (row == params.hoveredRow) { color = mix(color, HOVER, 0.6); }

  return vec4f(color, 1.0);
}
`;
