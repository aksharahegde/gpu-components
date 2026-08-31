/**
 * GPU hexbin: one thread per point, axial/odd-r conversion, atomicAdd into the viewport grid.
 * Weight is rounded to u32 — WGSL atomics are integer-only.
 */

export const HEXBIN_WORKGROUP_SIZE = 64;

export const HEXBIN_WGSL = /* wgsl */ `
struct Point {
  x: f32,
  y: f32,
  weight: f32,
  _pad: f32,
}

struct HexParams {
  hexSize: f32,
  minCol: i32,
  minRow: i32,
  cols: u32,
  rows: u32,
  count: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> params: HexParams;
@group(0) @binding(1) var<storage, read> points: array<Point>;
@group(0) @binding(2) var<storage, read_write> density: array<atomic<u32>>;

const SQRT3: f32 = 1.73205080757;

fn pixelToAxial(x: f32, y: f32, size: f32) -> vec2f {
  let q = ((SQRT3 / 3.0) * x - (1.0 / 3.0) * y) / size;
  let r = ((2.0 / 3.0) * y) / size;
  return vec2f(q, r);
}

fn axialRound(frac: vec2f) -> vec2i {
  var x = frac.x;
  var z = frac.y;
  var y = -x - z;

  var rx = round(x);
  var ry = round(y);
  var rz = round(z);

  let xDiff = abs(rx - x);
  let yDiff = abs(ry - y);
  let zDiff = abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return vec2i(i32(rx), i32(rz));
}

fn axialToOffset(q: i32, r: i32) -> vec2i {
  let col = q + (r - (r & 1)) / 2;
  return vec2i(col, r);
}

@compute @workgroup_size(${HEXBIN_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }

  let p = points[i];
  if (p.x != p.x || p.y != p.y || p.weight <= 0.0) {
    return;
  }

  let axial = axialRound(pixelToAxial(p.x, p.y, params.hexSize));
  let off = axialToOffset(axial.x, axial.y);
  let col = off.x - params.minCol;
  let row = off.y - params.minRow;
  if (col < 0 || row < 0 || u32(col) >= params.cols || u32(row) >= params.rows) {
    return;
  }

  let index = u32(row) * params.cols + u32(col);
  let w = max(1u, u32(round(p.weight)));
  atomicAdd(&density[index], w);
}
`;
