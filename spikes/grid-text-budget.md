# Spike: does `GPUDataGrid` need a glyph atlas?

**Date:** 2026-08-30 · **Status:** resolved · **Resolves:** PLAN.md §30 risk 2, §31 open question #6,
and the text prerequisite for §29 Phase 5's `GPUDataGrid`

## The question

§13.4 stages text as: DOM overlay to ~400 labels (v1), glyph atlas at ~50k glyphs (v2, "needed only
when label counts exceed DOM budget — i.e. when the DataGrid lands"). A grid viewport is about
40 columns × 60 rows = **2,400 text cells**: 6× the DOM budget, but 20× *under* the atlas threshold,
and in exactly the range where glide-data-grid already sustains 60fps on Canvas2D `fillText` — which
§4.3 concedes is "the honest bar".

Building a glyph atlas is the largest schedule risk in Phase 5 (§30 ranks it High/High, and §8.1
says front-loading it is how a project spends six months without shipping). So: measure before
building, the same way §20 measured before the Timeline was written.

## Method

`apps/bench/src/harness/textBudgetScenario.ts`, run via `tests/textBudgetOnly.spec.ts` in real
Chromium through Playwright (§20.1 environment (c)). 1200×700 viewport, 40 columns, 60 warmup frames
discarded, 180 measured frames, cell counts swept 600 → 4,800 so the crossover is visible rather than
inferred from one point.

Every cell's text **and** position changes on every frame — a scrolling grid never re-renders
identical content, and a strategy that only wins on static text would be answering the wrong
question.

**What is timed, and why it is not rAF intervals.** This measures CPU milliseconds of work per frame
via `performance.now()` brackets. The shared-vs-independent-device investigation
(`apps/bench/results/decision-record.md`, rounds 1–3) established that rAF-interval measurement has
a hard floor at the display's vsync rate and cannot resolve differences below ~16.6ms. Dropped
frames are still reported as a secondary signal — and for one strategy they turn out to be the
*primary* one.

Three strategies:

- **`dom`** — pooled, absolutely-positioned `<span>`s with `transform`-only position updates. This is
  precisely the "keyed pooling with `transform`-only updates" that §31 open question #6 proposes as
  its default, so this is a fair test of the proposed design, not a strawman.
- **`canvas2d`** — a 2D canvas layered over the GPU surface: `clearRect` + one `fillText` per cell.
- **`atlas-packing`** — the CPU half of a glyph-atlas path: per-glyph instance packing (8 glyphs per
  cell, 24-byte instances) plus the glyph→UV lookup. **Deliberately excludes the GPU draw**, so it is
  a *floor*, not an estimate of the atlas's total cost. The draw itself is already known to be
  negligible — `results/BASELINES.md` has the Timeline drawing millions of instanced quads per frame.

## Results

CPU ms per frame; `dropped` counts frames whose rAF delta exceeded 1.5 × 16.6ms, out of 180.

| Cells | Strategy | p50 | p95 | p99 | worst | dropped |
|---:|---|---:|---:|---:|---:|---:|
| 600 | dom | 0.300 | 0.400 | 0.400 | 0.400 | **106** |
| 600 | canvas2d | 1.700 | 2.600 | 2.700 | 2.900 | 0 |
| 600 | atlas-packing | 0.200 | 0.300 | 0.300 | 0.400 | 0 |
| 1,200 | dom | 0.600 | 0.700 | 0.900 | 1.100 | **180** |
| 1,200 | canvas2d | 2.100 | 2.400 | 2.600 | 2.600 | 0 |
| 1,200 | atlas-packing | 0.400 | 0.600 | 0.600 | 0.600 | 0 |
| **2,400** | **dom** | 1.200 | 1.700 | 2.200 | 2.400 | **180** |
| **2,400** | **canvas2d** | 2.900 | 3.200 | 3.300 | 3.600 | **0** |
| **2,400** | **atlas-packing** | 1.000 | 1.200 | 1.200 | 1.200 | 0 |
| 4,800 | dom | 2.300 | 4.100 | 4.500 | 4.800 | **180** |
| 4,800 | canvas2d | 4.200 | 4.500 | 4.600 | 4.600 | 0 |
| 4,800 | atlas-packing | 1.800 | 2.000 | 2.000 | 2.100 | 0 |

### Reading the DOM row correctly — this is the important part

DOM has the **lowest CPU time of all three strategies** and **drops every single measured frame** from
1,200 cells upward. Those two facts are not in conflict: style recalculation, layout, paint and
composite all happen *after* the JS callback returns, outside the `performance.now()` bracket. The
work is real; it simply is not where the timer is.

Anyone reading only the CPU column would conclude DOM is the fastest option. It is the worst one.
Recording this because it is a trap the next person will walk into, and because it is the second time
this project has been misled by measuring the wrong quantity — the first being rAF intervals in the
shared-device investigation.

## Verdict

**`GPUDataGrid` does not need a glyph atlas for v1. Use a Canvas2D text layer.**

At the 2,400-cell reference: **2.9ms p50, 3.6ms worst, zero dropped frames** — comfortably inside a
16.6ms budget with roughly 4.5× headroom, and still fine at double the cell count (4.2ms at 4,800).
It scales linearly and predictably, and its worst-case spread is tight (p50→worst is 0.7ms).

This deletes the largest schedule risk in Phase 5. The atlas moves from *prerequisite* to
*optimisation*, to be justified later by a workload that actually needs it.

**Three consequences for the plan:**

1. **§13.4's staging is right, and its threshold is roughly right too.** DOM starts missing frames
   between 400 and 600 labels, so the Timeline's ~400 cap is close to the real ceiling rather than a
   guess — v1's choice is vindicated by measurement. What changes is the *v2 trigger*: the DataGrid
   is no longer the thing that forces an atlas.
2. **§31 open question #6 is resolved, with a correction.** Its proposed default — "keyed pooling with
   `transform`-only updates" — is what was measured, and it does not hold at grid scale. The
   documented fallback ("a canvas text layer") is the answer, and should become the default for any
   component above a few hundred labels.
3. **The atlas's CPU floor is ~3× cheaper than Canvas2D** (1.0ms vs 2.9ms at 2,400 cells) and its
   draw cost is negligible, so an atlas *would* be faster. It is simply not needed at this scale, and
   "faster than something that already fits in budget with 4.5× headroom" is not a reason to build the
   hardest subsystem in the project.

## What this spike did not measure

- **Text quality.** Canvas2D `fillText` at DPR > 1, subpixel positioning, and font hinting were not
  compared against an atlas. Crispness is the atlas's other argument and remains untested.
- **RTL, IME, and complex scripts.** Canvas2D handles these natively; an atlas would not without
  substantial extra work. This *strengthens* the verdict but was not measured.
- **Text selection and copy.** DOM text is natively selectable — §21.2 makes that an accessibility
  requirement for the Timeline's labels. A Canvas2D text layer is not selectable, so the grid needs a
  separate answer here (a DOM overlay for the *focused* row only, or `toAccessibleTable()`).
  **This is the one real cost of the verdict and it should be designed before the grid ships.**
- **One machine, one browser.** Same caveat as `results/BASELINES.md`: Chromium on a single hardware
  tier. The margin (4.5×) is wide enough that the conclusion is unlikely to invert, but the numbers
  are not portable claims.
