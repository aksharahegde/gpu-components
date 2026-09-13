/**
 * Value-axis gridlines for `GPUHistogram`, through `LineLayer`.
 */

import { LINE_FLAG_CLIP_Y, packRgba8, type LineInstance, type ViewportState } from "@gpuc/core";

const TARGET_TICKS = 8;
const MAX_RULES = 64;
const WIDTH_PX = 1;
const COLOR = packRgba8(13, 15, 20, 34);
const BASELINE_COLOR = packRgba8(13, 15, 20, 64);

export function niceTickStep(span: number, target = TARGET_TICKS): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function computeAxisRules(viewport: ViewportState): LineInstance[] {
  const rules: LineInstance[] = [];
  const span = viewport.timeEnd - viewport.timeStart;
  if (!(span > 0)) return rules;

  const step = niceTickStep(span);
  for (let t = Math.ceil(viewport.timeStart / step) * step; t <= viewport.timeEnd; t += step) {
    if (rules.length >= MAX_RULES - 1) break;
    rules.push({
      x0: t,
      y0: -1,
      x1: t,
      y1: 1,
      widthPx: WIDTH_PX,
      color: COLOR,
      flags: LINE_FLAG_CLIP_Y,
    });
  }

  // Baseline at the bottom of the count axis (domain y = 1 with yContinuous [0,1]).
  rules.push({
    x0: viewport.timeStart,
    y0: 1,
    x1: viewport.timeEnd,
    y1: 1,
    widthPx: WIDTH_PX,
    color: BASELINE_COLOR,
  });

  return rules;
}

export const MAX_AXIS_RULES = MAX_RULES;
