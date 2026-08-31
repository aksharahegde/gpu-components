/**
 * Pointy-top odd-r hex helpers shared by CPU hover and the hexbin/hex shaders.
 *
 * Layout follows Red Blob Games' "odd-r" offset coordinates: a rectangular `(col, row)` array
 * covers the viewport, and axial `(q, r)` is only used for pixel conversion and cube rounding.
 */

import type { ViewportState } from "@gpu-components/core";
import { rowRange } from "@gpu-components/core";

const SQRT3 = Math.sqrt(3);

export interface Axial {
  readonly q: number;
  readonly r: number;
}

export interface Offset {
  readonly col: number;
  readonly row: number;
}

export interface HexGridLayout {
  /** Effective hex size in projected metres (may be raised to honour `MAX_HEXES`). */
  readonly hexSize: number;
  readonly minCol: number;
  readonly minRow: number;
  readonly cols: number;
  readonly rows: number;
  readonly cellCount: number;
}

/** Ceiling on hex cells covering the viewport — §24.2 bounded work. */
export const MAX_HEXES = 16_384;

/** Default on-screen hex width in CSS pixels when `hexSize` (metres) is omitted. */
export const DEFAULT_HEX_SIZE_PX = 14;

/**
 * Projected metres for a pointy-top hex whose *width* (`√3 * size`) spans `sizePx` CSS pixels
 * at the current viewport scale. Keeps cells readable when zoomed out instead of collapsing to
 * a few sub-pixel dots.
 */
export function hexSizeFromViewportPx(viewport: ViewportState, sizePx: number): number {
  const unitsPerPx = (viewport.timeEnd - viewport.timeStart) / Math.max(viewport.width, 1);
  return Math.max(1e-6, (Math.max(sizePx, 1) * unitsPerPx) / SQRT3);
}

/** Axial (pointy-top) → projected metres. */
export function axialToPixel(q: number, r: number, size: number): { readonly x: number; readonly y: number } {
  return {
    x: size * (SQRT3 * q + (SQRT3 / 2) * r),
    y: size * ((3 / 2) * r),
  };
}

/** Projected metres → fractional axial (before cube round). */
export function pixelToAxial(x: number, y: number, size: number): Axial {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return { q, r };
}

/** Cube-round a fractional axial coordinate to the nearest hex. */
export function axialRound(frac: Axial): Axial {
  let x = frac.q;
  let z = frac.r;
  let y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;

  return { q: rx === 0 ? 0 : rx, r: rz === 0 ? 0 : rz };
}

export function axialToOffset(axial: Axial): Offset {
  const col = axial.q + (axial.r - (axial.r & 1)) / 2;
  return { col, row: axial.r };
}

export function offsetToAxial(offset: Offset): Axial {
  const q = offset.col - (offset.row - (offset.row & 1)) / 2;
  return { q, r: offset.row };
}

export function offsetToPixel(offset: Offset, size: number): { readonly x: number; readonly y: number } {
  const axial = offsetToAxial(offset);
  return axialToPixel(axial.q, axial.r, size);
}

/** Nearest hex under a projected point. */
export function pixelToOffset(x: number, y: number, size: number): Offset {
  return axialToOffset(axialRound(pixelToAxial(x, y, size)));
}

/**
 * Builds a viewport-covering odd-r hex grid. If `hexSize` would produce more than `maxHexes`
 * cells, size is raised until the count fits.
 */
export function layoutHexGrid(
  viewport: ViewportState,
  hexSize: number,
  maxHexes = MAX_HEXES,
): HexGridLayout {
  const x0 = viewport.timeStart;
  const x1 = viewport.timeEnd;
  const [y0, y1] = rowRange(viewport);

  let size = Math.max(hexSize, 1e-6);
  for (let attempt = 0; attempt < 64; attempt++) {
    const corners: Offset[] = [
      pixelToOffset(x0, y0, size),
      pixelToOffset(x1, y0, size),
      pixelToOffset(x0, y1, size),
      pixelToOffset(x1, y1, size),
    ];
    let minCol = Infinity;
    let maxCol = -Infinity;
    let minRow = Infinity;
    let maxRow = -Infinity;
    for (const c of corners) {
      if (c.col < minCol) minCol = c.col;
      if (c.col > maxCol) maxCol = c.col;
      if (c.row < minRow) minRow = c.row;
      if (c.row > maxRow) maxRow = c.row;
    }
    // One-cell pad so edge points never fall outside the atomic grid.
    minCol -= 1;
    maxCol += 1;
    minRow -= 1;
    maxRow += 1;

    const cols = Math.max(1, maxCol - minCol + 1);
    const rows = Math.max(1, maxRow - minRow + 1);
    const cellCount = cols * rows;
    if (cellCount <= maxHexes) {
      return { hexSize: size, minCol, minRow, cols, rows, cellCount };
    }
    // Scale so the next try lands near the budget rather than growing by a constant factor forever.
    size *= Math.sqrt(cellCount / maxHexes) * 1.05;
  }

  // Degenerate fallback: a single cell covering the whole view.
  const centre = pixelToOffset((x0 + x1) / 2, (y0 + y1) / 2, size);
  return { hexSize: size, minCol: centre.col, minRow: centre.row, cols: 1, rows: 1, cellCount: 1 };
}

/** Flat index into the density buffer, or `-1` when outside the layout. */
export function offsetIndex(layout: HexGridLayout, offset: Offset): number {
  const col = offset.col - layout.minCol;
  const row = offset.row - layout.minRow;
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return -1;
  return row * layout.cols + col;
}
