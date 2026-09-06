import { LINE_FLAG_CLIP_X, LINE_FLAG_CLIP_Y, packRgba8 } from "@gpu-components/core";
import type { LineInstance, ViewportState } from "@gpu-components/core";

/**
 * The axis rules of PLAN.md §12.2's overlay ("hover outline, selection, brush rect, **axis rules**,
 * cursor") — time gridlines and track separators, drawn through `core`'s `LineLayer`.
 *
 * Everything here is pure and CPU-side: rule *positions* are small-N and branchy, which is exactly
 * what PLAN.md §5.2 says stays off the GPU. Only the resulting handful of line instances crosses to
 * the GPU, where the same viewport uniform that transforms spans transforms them too — so a rule
 * can never drift out of alignment with the spans it rules across.
 *
 * These constants are deliberately constants and not props. This file is copied into the consuming
 * repo (PLAN.md §18), and tick density / rule colour are exactly the "policy a props API can never
 * anticipate" that the copy-the-source model exists to hand over.
 */

/** Roughly how many time gridlines to aim for across the visible domain; the nice-step rounding
 * below lands on 0.5–2× this depending on where the domain falls relative to a power of ten. */
const TARGET_TIME_RULES = 10;
/** Hard ceiling on emitted rules, independent of zoom or track count — an unbounded rule set from
 * a hostile `trackCount` is the same denial-of-service shape PLAN.md §24.2 bounds elsewhere. */
const MAX_RULES = 128;
/** Below this row height, track separators are visual noise (adjacent rules would touch), so they
 * are dropped entirely rather than drawn as a grey smear. */
const MIN_ROW_HEIGHT_PX = 6;

const TIME_RULE_WIDTH_PX = 1;
const TRACK_RULE_WIDTH_PX = 1;
/** Low-alpha white, composited by the layer's `alpha` blend over whatever is underneath. Kept
 * dimmer than the track separators so the two families read as different information. */
const TIME_RULE_COLOR = packRgba8(13, 15, 20, 32);
const TRACK_RULE_COLOR = packRgba8(13, 15, 20, 44);

/**
 * A "nice" tick interval — 1, 2 or 5 times a power of ten — covering `span` in about `target`
 * steps. The standard axis-labelling rounding, so ticks land on round numbers a reader can name
 * ("every 200ms") instead of on whatever `span / target` happens to be.
 */
export function niceTickStep(span: number, target = TARGET_TIME_RULES): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** The absolute times at which a gridline falls, for the currently visible domain. */
export function timeRuleTicks(viewport: ViewportState): number[] {
  const span = viewport.timeEnd - viewport.timeStart;
  if (!Number.isFinite(span) || span <= 0) return [];
  const step = niceTickStep(span);
  const ticks: number[] = [];
  // `Math.ceil` of a value already exactly on a step can drift by one ulp; the loop's `<=` bound
  // and the MAX_RULES cap make an extra or missing edge tick harmless either way.
  for (let t = Math.ceil(viewport.timeStart / step) * step; t <= viewport.timeEnd; t += step) {
    ticks.push(t);
    if (ticks.length >= MAX_RULES) break;
  }
  return ticks;
}

/**
 * Builds the full rule set for a viewport. `originTime` is the dataset-local origin
 * (`spikes/gpu-time-precision.md`): rule x coordinates are origin-relative for the same reason span
 * start times are, since both are narrowed to `f32` and transformed by the same uniform.
 */
export function computeAxisRules(viewport: ViewportState, originTime = 0): LineInstance[] {
  const rules: LineInstance[] = [];

  // Time gridlines: x in the time domain, y spanning the full surface in clip space so a rule does
  // not need to know the track count.
  for (const tick of timeRuleTicks(viewport)) {
    const x = tick - originTime;
    rules.push({
      x0: x,
      y0: -1,
      x1: x,
      y1: 1,
      widthPx: TIME_RULE_WIDTH_PX,
      color: TIME_RULE_COLOR,
      flags: LINE_FLAG_CLIP_Y,
    });
  }

  // Track separators: the mirror case — y on the track-row domain at each interior row boundary
  // (row k's top edge is at k - 0.5), x spanning the full width in clip space.
  const trackCount = Math.floor(viewport.trackCount);
  const rowHeightPx = viewport.height / Math.max(1, trackCount);
  if (rowHeightPx >= MIN_ROW_HEIGHT_PX) {
    for (let k = 1; k < trackCount && rules.length < MAX_RULES; k++) {
      rules.push({
        x0: -1,
        y0: k - 0.5,
        x1: 1,
        y1: k - 0.5,
        widthPx: TRACK_RULE_WIDTH_PX,
        color: TRACK_RULE_COLOR,
        flags: LINE_FLAG_CLIP_X,
      });
    }
  }

  return rules;
}

/** Upper bound on the rules `computeAxisRules` can return — the `LineLayer` capacity to presize to,
 * so the layer never grows and never trips PLAN.md §28.2's buffer-growth warning. */
export const MAX_AXIS_RULES = MAX_RULES;
