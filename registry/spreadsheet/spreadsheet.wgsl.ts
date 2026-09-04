/**
 * `GPUSpreadsheet`'s cell-chrome pass — `registry/grid/grid.wgsl.ts` extended for a spreadsheet's
 * two new visual needs: a **multi-cell selection rectangle** (a grid only ever has one selected
 * row) and a **dirty-cell flash** for cells the formula engine just recalculated.
 *
 * Both are uniform/storage-buffer writes computed by `SpreadsheetComponent`, not per-frame
 * re-derivation — the flash alpha per cell is computed on the CPU (small-N: at most
 * `MAX_FLASH_CELLS` cells decaying over a few hundred ms) and the shader only blends the
 * precomputed value, the same "small-N stays on the CPU" split as everything else in this
 * component (PLAN.md §5.2).
 *
 * Per-cell values instead of the grid's per-numeric-column indirection, because a spreadsheet
 * column has no fixed type — see the comment at the top of \`ingest.ts\`.
 *
 * This shader draws no text, same as the grid's — see \`textLayer.ts\`.
 */
export const MAX_FLASH_CELLS = 128;

export const SPREADSHEET_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct SheetParams {
  rowCount: u32,
  columnCount: u32,
  hoveredRow: i32,
  hoveredCol: i32,
  selRowStart: i32,
  selRowEnd: i32,
  selColStart: i32,
  selColEnd: i32,
  scrollX: f32,
  totalWidth: f32,
  rangeLo: f32,
  rangeHi: f32,
  flashCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: SheetParams;
// Row-major, one entry per cell — NaN for non-numeric cells (see \`ingest.ts\`).
@group(0) @binding(2) var<storage, read> values: array<f32>;
// Left pixel offset of every column, plus a final total-width entry — a CPU-computed prefix sum,
// same convention \`registry/grid/grid.wgsl.ts\` uses.
@group(0) @binding(3) var<storage, read> columnOffsets: array<f32>;
// Packed (row << 16 | col) per flashing cell, and its current alpha — both CPU-computed per frame
// while any flash is active (\`SpreadsheetComponent.animating\`), unused otherwise.
@group(0) @binding(4) var<storage, read> flashCells: array<u32>;
@group(0) @binding(5) var<storage, read> flashAlphas: array<f32>;

const ROW_EVEN = vec3f(0.055, 0.063, 0.075);
const ROW_ODD  = vec3f(0.075, 0.086, 0.102);
const HOVER    = vec3f(0.16, 0.18, 0.23);
const SELECTED = vec3f(0.20, 0.24, 0.34);
const FLASH    = vec3f(0.30, 0.42, 0.30);
const HEAT_LO = vec3f(0.10, 0.16, 0.28);
const HEAT_HI = vec3f(0.42, 0.24, 0.16);

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

/** Linear scan — bounded by \`MAX_FLASH_CELLS\`, so this is a small, fixed-cost loop per fragment,
 * not a correctness risk the way an unbounded scan would be. */
fn flashAlphaFor(row: i32, col: i32) -> f32 {
  let packed = (u32(row) << 16u) | u32(col);
  var alpha = 0.0;
  for (var i = 0u; i < params.flashCount; i = i + 1u) {
    if (flashCells[i] == packed) {
      alpha = flashAlphas[i];
      break;
    }
  }
  return alpha;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let clipY = 1.0 - 2.0 * uv.y;
  let rowF = (clipY - viewport.trackToClip.y) / viewport.trackToClip.x;
  let row = i32(round(rowF));
  if (row < 0 || u32(row) >= params.rowCount) {
    discard;
  }

  let x = params.scrollX + uv.x * (2.0 / viewport.pxSize.x);
  let column = columnAt(x);
  if (column < 0) {
    discard;
  }

  var color = select(ROW_EVEN, ROW_ODD, (row % 2) == 1);

  let value = values[u32(row) * params.columnCount + u32(column)];
  if (value == value) {   // not NaN
    let t = clamp((value - params.rangeLo) / max(params.rangeHi - params.rangeLo, 1e-20), 0.0, 1.0);
    color = mix(color, mix(HEAT_LO, HEAT_HI, t), 0.55);
  }

  let inSelection = row >= params.selRowStart && row <= params.selRowEnd &&
                     column >= params.selColStart && column <= params.selColEnd;
  if (inSelection) {
    color = mix(color, SELECTED, 0.55);
  }
  if (row == params.hoveredRow && column == params.hoveredCol) {
    color = mix(color, HOVER, 0.5);
  }

  let flash = flashAlphaFor(row, column);
  if (flash > 0.0) {
    color = mix(color, FLASH, flash * 0.6);
  }

  return vec4f(color, 1.0);
}
`;
