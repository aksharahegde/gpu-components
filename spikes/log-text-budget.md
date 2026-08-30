# Spike: does `GPULogViewer` need a glyph atlas?

**Date:** 2026-08-30 · **Status:** resolved · **Answer: no** · **Resolves:** the text prerequisite for
`GPULogViewer`, and a second data point on PLAN.md §30 risk 2 and §12.1's fourth primitive

## The question

`GPULogViewer` was selected as the seventh component partly on the argument that it would **force
`LabelLayer`** — §12.1 promises four rendering primitives and three exist, and the Canvas2D fallback
(§22.2) is waiting on a fourth to dispatch on. Text has been deferred since Phase 4 and is the
largest unretired schedule risk in the plan.

`spikes/grid-text-budget.md` already answered this question once, for `GPUDataGrid`, and the answer
was no: 2,400 cells cost **2.9ms p50 on Canvas2D with zero dropped frames**, so the grid shipped with
a Canvas2D text layer and the atlas became an optimisation nobody needed.

The reason to ask again rather than assume the same answer is that a log viewer's text has a
different *shape*, and one property of it is genuinely worse:

- **Better than the grid on call count.** A log line drawn as one `fillText` is 60 calls for a 60-line
  window — a fortieth of the grid's 2,400. On this axis the question is not close.
- **Worse than the grid on redraw.** The grid re-renders on damage; between scrolls its content is
  static. A log viewer that is scrolling or tailing moves *every* line every frame, so there is no
  damage region to exploit and the full cost is paid on every frame.
- **Worse than the grid on run count.** A 2D context carries one `fillStyle`, so every colour change
  is another call. A log line is a timestamp, a level, a logger, a message and any highlighted search
  matches — about 4.3 runs per line here. The real call count is lines × runs, not lines.

So: measure, exactly as the grid did, and let the number decide.

## Method

`apps/bench/src/harness/logTextScenario.ts`, run via `tests/logTextOnly.spec.ts` in real Chromium
through Playwright (§20.1 environment (c)). 1400px wide, 12px monospace (~7.2px advance, ~190
columns), 15px line height, 60 warmup frames discarded, 180 measured frames.

Line content varies with each line's absolute index and the window scrolls one line per frame, so
every frame draws genuinely different text — the same guard the grid spike used to avoid measuring a
strategy that only wins on unchanged content.

**What is timed:** CPU milliseconds per frame via `performance.now()` brackets, never rAF intervals.
`apps/bench/results/decision-record.md` rounds 1–3 established that rAF-interval measurement has a
hard floor at the display's vsync rate and cannot resolve differences below ~16.6ms. Dropped frames
are reported as a secondary signal.

Three strategies:

- **`canvas2d-line`** — one `fillText` per line, whole line in one colour. The floor, and the honest
  counter-argument: this is what a log viewer would cost if it never needed per-token colour.
- **`canvas2d-runs`** — one `fillText` per coloured run. **This is the number the atlas has to beat.**
- **`atlas-packing`** — the CPU half of an atlas path: per-glyph instance packing (24-byte instances)
  plus the glyph→UV lookup over a ~190-glyph ASCII + Latin-1 map. **Excludes the GPU draw**, so it is
  a *floor* for the atlas, not an estimate of its total cost — the same caveat, for the same reason,
  as in the grid spike. The draw itself is known-negligible (`results/BASELINES.md`).

### A methodology bug worth recording, because the first run was wrong

The first run fixed the canvas at 1400×900 and swept up to 240 lines. At 15px per line, 240 lines is
3,600px of text into a 900px surface, and the 240-line row came back **cheaper per glyph than the
60-line row** — Chromium was cheap-rejecting every `fillText` whose baseline fell off the canvas, so
three quarters of the work at the top of the sweep was never done.

The canvas now grows with the sweep. The corrected numbers scale monotonically with line count, which
is the sanity check the first run failed. A benchmark that silently stops doing the work it claims to
measure is worse than no benchmark, and the only reason this was caught is that the shape of the
result was implausible.

## Results

CPU ms per frame. `calls` is `fillText` invocations per frame; `dropped` counts rAF deltas over
1.5 × 16.6ms out of 180 (floor-limited, and see the note below).

| Lines | Strategy | Glyphs | Calls | p50 | p95 | p99 | worst |
|---:|---|---:|---:|---:|---:|---:|---:|
| 30 | canvas2d-line | 3,014 | 30 | 0.000 | 0.100 | 0.100 | 0.200 |
| 30 | canvas2d-runs | 3,014 | 130 | 0.100 | 0.100 | 0.200 | 0.200 |
| 30 | atlas-packing | 3,014 | 0 | 0.000 | 0.100 | 0.100 | 0.100 |
| **60** | **canvas2d-line** | **6,028** | **60** | **0.100** | **0.100** | **0.200** | **0.200** |
| **60** | **canvas2d-runs** | **6,028** | **260** | **0.100** | **0.200** | **0.200** | **0.200** |
| **60** | **atlas-packing** | **6,028** | **0** | **0.100** | **0.100** | **0.200** | **0.200** |
| 120 | canvas2d-line | 12,056 | 120 | 0.100 | 0.200 | 0.200 | 0.300 |
| 120 | canvas2d-runs | 12,056 | 520 | 0.200 | 0.300 | 0.300 | 0.300 |
| 120 | atlas-packing | 12,056 | 0 | 0.100 | 0.200 | 0.200 | 0.200 |
| 240 | canvas2d-line | 24,112 | 240 | 0.300 | 0.300 | 0.400 | 0.400 |
| 240 | canvas2d-runs | 24,112 | 1,040 | 0.400 | 0.400 | 0.500 | 0.500 |
| 240 | atlas-packing | 24,112 | 0 | 0.200 | 0.300 | 0.300 | 0.300 |

The 60-line row is the realistic window. 120 and 240 are stress points, not window sizes.

Dropped frames sat at 8–14 out of 180 for *every* strategy including the ones doing almost no work,
so they are measuring harness and compositor noise here, not the strategies. Unlike the grid spike —
where the DOM strategy dropped all 180 frames and that was the headline — this column carries no
signal in this scenario and no conclusion rests on it.

## Conclusion: do not build the glyph atlas

**At the realistic 60-line window, per-run Canvas2D text costs 0.1ms p50 — about 0.6% of a 16.6ms
frame.** The atlas-packing floor is also 0.1ms, which is to say the two are indistinguishable at the
0.1ms resolution Chromium's clamped timer allows, *and the atlas number excludes its GPU draw while
the Canvas2D number is complete.*

Even at 240 lines — four times a real window, a surface nobody has — Canvas2D per-run costs 0.4ms,
2.4% of a frame. There is no crossover anywhere in the sweep. The atlas never wins.

This is the second component predicted to force the atlas that does not. The first, `GPUDataGrid`,
had the stronger case of the two on raw call count and still lost by a factor of five.

### What this means for `LabelLayer` and §12.1

`LabelLayer` stays unbuilt, now with two measurements behind that decision rather than one. §12.1's
own drift note already conceded it is "less clearly a gap than `LineLayer` was", since §13.4 makes
the DOM overlay the deliberate v1 label path. This spike converts that hedge into evidence.

The honest remaining triggers for an atlas, neither of which any shipped or planned component hits:

1. **Text that must zoom continuously** — an SDF atlas stays crisp at any scale where a fixed-size
   raster does not. Nothing here zooms text; the log viewer scrolls it at one size.
2. **Per-glyph styling driven by GPU-computed state**, where a CPU round-trip to decide colours would
   be the bottleneck. The log viewer's highlight state is computed once per query on the CPU (§5.2
   keeps string matching there), not per frame, so it never needs the round-trip.

### What this means for `GPULogViewer`

The component keeps its other justification and loses this one. Its GPU case does not rest on text:
millions of resident lines with scroll as a uniform write (§5 gate 3), a match-density reduction
across the whole buffer for the minimap (gate 2), and streaming append into a ring buffer — the
`RingBuffer` primitive is still unbuilt and still untested by anything.

Text is the tax, and the log viewer pays it the same way the grid does: a Canvas2D layer over the GPU
surface, with the same accessibility caveat §21.2 imposes and the same answer `GPUDataGrid.tsx` gives
it — a real DOM overlay for the focused line plus a semantic model, and canvas text for the rest.

## Reproducing

```
cd apps/bench && npx playwright test tests/logTextOnly.spec.ts --reporter=line
```
