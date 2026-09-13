/**
 * Illustrative world outline — coarse closed polylines in lon/lat, projected at module load.
 * Not cartographic: enough chrome to read as a map without shipping Natural Earth.
 */

import { packRgba8, type LineInstance } from "@gpu-components/core";
import { lonLatToMercator } from "./mercator.ts";

const WIDTH_PX = 1.25;
const COLOR = packRgba8(90, 120, 145, 110);

/** Coarse continent / landmass rings as [lon, lat][] (degrees). */
const RINGS: readonly (readonly (readonly [number, number])[])[] = [
  // Rough Americas
  [
    [-168, 65], [-140, 65], [-120, 50], [-105, 32], [-97, 18], [-90, 15], [-80, 8],
    [-75, -5], [-70, -20], [-70, -40], [-75, -55], [-68, -55], [-60, -40], [-55, -25],
    [-45, -5], [-35, 0], [-50, 5], [-60, 10], [-70, 20], [-80, 25], [-85, 30],
    [-75, 40], [-70, 45], [-65, 50], [-60, 60], [-80, 70], [-120, 70], [-150, 70], [-168, 65],
  ],
  // Rough Eurasia–Africa
  [
    [-10, 35], [-5, 45], [0, 50], [10, 55], [20, 70], [40, 70], [60, 65], [80, 55],
    [100, 50], [120, 45], [140, 45], [145, 50], [160, 60], [175, 65], [180, 60],
    [150, 40], [140, 30], [120, 20], [100, 10], [80, 5], [70, 10], [60, 20],
    [50, 15], [45, 5], [40, -5], [35, -15], [30, -25], [20, -35], [15, -30],
    [10, -15], [5, 0], [0, 10], [-5, 20], [-10, 30], [-10, 35],
  ],
  // Rough Australia
  [
    [115, -20], [125, -15], [135, -12], [145, -15], [150, -25], [150, -35],
    [145, -40], [135, -38], [125, -35], [115, -32], [115, -20],
  ],
  // Rough Antarctica strip (southern band)
  [
    [-180, -70], [-90, -70], [0, -70], [90, -70], [180, -70],
    [180, -80], [0, -80], [-180, -80], [-180, -70],
  ],
];

function ringToLines(ring: readonly (readonly [number, number])[]): LineInstance[] {
  const lines: LineInstance[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = lonLatToMercator(ring[i]![0], ring[i]![1]);
    const b = lonLatToMercator(ring[i + 1]![0], ring[i + 1]![1]);
    if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
    lines.push({
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y,
      widthPx: WIDTH_PX,
      color: COLOR,
    });
  }
  return lines;
}

/** Pre-projected outline segments — static for the life of the module. */
export const WORLD_OUTLINE_LINES: readonly LineInstance[] = RINGS.flatMap(ringToLines);

export const MAX_WORLD_OUTLINE = WORLD_OUTLINE_LINES.length;
