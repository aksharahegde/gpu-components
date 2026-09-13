/**
 * Lon/lat graticule → mercator `LineInstance`s for `LineLayer`. Pure CPU, capped — same role as
 * timeline `axisRules.ts`.
 */

import { packRgba8, type LineInstance, type ViewportState } from "@gpuc/core";
import { rowRange } from "@gpuc/core";
import { lonLatToMercator, mercatorToLonLat } from "./mercator.ts";

const MAX_GRATICULE_LINES = 96;

function niceTickStep(span: number, target = 8): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}
const LINE_WIDTH_PX = 1;
const COLOR = packRgba8(13, 15, 20, 34);

/**
 * Builds meridians and parallels covering the visible mercator viewport. Tick spacing follows
 * lon/lat degrees (nice steps), then each tick is projected — so the chrome stays geographic
 * rather than an equal-metre grid that shears under Mercator.
 */
export function computeGraticule(viewport: ViewportState): LineInstance[] {
  const [y0, y1] = rowRange(viewport);
  const sw = mercatorToLonLat(viewport.timeStart, y1);
  const ne = mercatorToLonLat(viewport.timeEnd, y0);
  const lonMin = Math.min(sw.lon, ne.lon);
  const lonMax = Math.max(sw.lon, ne.lon);
  const latMin = Math.min(sw.lat, ne.lat);
  const latMax = Math.max(sw.lat, ne.lat);

  const lonSpan = Math.max(lonMax - lonMin, 1e-6);
  const latSpan = Math.max(latMax - latMin, 1e-6);
  const lonStep = niceTickStep(lonSpan, 8);
  const latStep = niceTickStep(latSpan, 8);

  const lines: LineInstance[] = [];

  for (let lon = Math.ceil(lonMin / lonStep) * lonStep; lon <= lonMax; lon += lonStep) {
    if (lines.length >= MAX_GRATICULE_LINES) break;
    const a = lonLatToMercator(lon, latMin);
    const b = lonLatToMercator(lon, latMax);
    if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
    lines.push({
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y,
      widthPx: LINE_WIDTH_PX,
      color: COLOR,
    });
  }

  for (let lat = Math.ceil(latMin / latStep) * latStep; lat <= latMax; lat += latStep) {
    if (lines.length >= MAX_GRATICULE_LINES) break;
    const a = lonLatToMercator(lonMin, lat);
    const b = lonLatToMercator(lonMax, lat);
    if (!Number.isFinite(a.y) || !Number.isFinite(b.y)) continue;
    lines.push({
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y,
      widthPx: LINE_WIDTH_PX,
      color: COLOR,
    });
  }

  return lines;
}

export const MAX_GRATICULE = MAX_GRATICULE_LINES;
