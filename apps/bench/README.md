# apps/bench

PLAN.md §20's benchmark harness — the Phase 0 deliverable that was skipped when implementation
jumped straight to Phase 1–3 (see git history: no `apps/bench`, no baselines, no CI existed before
this). This backfills it: deterministic seeded datasets, four real renderers (DOM, Canvas2D, WebGL2,
WebGPU), a Playwright harness measuring all four in one real browser, and a committed
`results/BASELINES.md`.

## Run it

```bash
npm install
npx playwright install chromium   # one-time browser download

npm run bench:quick   # fast subset (2 sizes, 1 run) — verify the harness works
npm run bench         # the full matrix — 6 sizes × 3 shapes × 4 renderers × 3 runs. Slow; the
                       # largest cells (5M/10M spans) can each take minutes.
npm run trend         # headless vgpu/node (Dawn) WebGPU-only check, no browser needed
```

`npm run bench` (and `bench:quick`) write `results/BASELINES.md` and `results/baselines.json`.
`npm run trend` appends a line to `results/trend.jsonl`.

## What this is, and isn't

PLAN.md §20 specifies a 3-browser × 3-hardware-tier × 6-size × 3-shape × 4-renderer matrix with GPU
timestamp queries, dropped-frame tracking, interaction latency, and CPU/GPU memory accounting. What
actually ships here — and what's still missing — is stated in full in `results/BASELINES.md`'s own
"Methodology" and "Not yet measured" sections after a run, so the numbers are never presented as more
complete than they are. Short version: real Chromium (this dev machine, one hardware tier), four real
renderers, p50/p95/p99/worst/dropped-frames/upload-cost. Not yet: Firefox/WebKit/Safari, multiple
hardware tiers, interaction latency, memory accounting, the software-renderer correctness-snapshot
environment.

## Layout

- `src/generators.ts` — seeded PRNG, three shapes (`shallow-wide`, `deep-nested`, `bursty`) × six
  sizes (1k → 10M), columnar `Float64Array`/`Uint16Array` output (not `RawSpan[]` — 10M objects would
  be its own benchmark).
- `src/renderers/` — one file per renderer. `dom.ts`/`canvas2d.ts` mirror
  `apps/site/src/components/SpanBenchmark.tsx`'s approach. `webgl2.ts` is a from-scratch minimal
  instanced-quad renderer (no framework — `packages/core`'s `InstancedQuadLayer` is WebGPU-only).
  `webgpu.ts` drives the real `registry/timeline/TimelineComponent.ts` via `GpuRuntime`, no React —
  this measures the actual runtime, not a stand-in.
- `src/harness/runner.ts` — warmup/measure/percentile logic, shared by every renderer×size×shape
  cell. `sharedContextScenario.ts` is the one-off check for Phase 0 goal (a): one shared `GpuRuntime`
  vs. two independent ones. `report.ts` formats `results/BASELINES.md`.
- `browser/` — the page Playwright drives (`vite.config.ts` serves it; `server.fs.allow` is widened
  to the repo root since `webgpu.ts` imports `registry/timeline/*` directly).
- `ci/trend.mjs` — standalone Node script, `vgpu/node` (headless Dawn), WebGPU-only, for CI
  regression-trend tracking without needing a browser. Has one known rough edge — see the comment at
  the top of the file — around `@gpu-components/testing`'s canvas-texture mock and real Dawn's
  stricter validation; it still runs and produces real numbers.

## Renderer cutoffs

DOM is capped at 20,000 spans (matches `SpanBenchmark.tsx`'s own documented cap — PLAN.md §20.3
itself says DOM is "unusable above ~10k"). A capped-out cell shows up in `BASELINES.md` as a skipped
cell with a reason, never silently omitted.
