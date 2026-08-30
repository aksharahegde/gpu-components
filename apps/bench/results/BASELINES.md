# Baselines

Generated 2026-08-30T09:05:21.294Z on `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36`.

## Methodology

- Datasets: deterministic seeded generators (see `src/generators.ts`), 3 shapes × the sizes actually measured below.
- Environment: real Chromium via Playwright (`playwright.config.ts`) — PLAN.md §20.1 environment (c). A separate headless `vgpu/node` (Dawn) script (`ci/trend.mjs`) covers environment (a), WebGPU-only, for CI trend-tracking.
- 200 warmup + 300 measured frames per run below 1M spans; scaled down to 50+100 at 1M–1M spans (1M–4.9M) and 20+40 at ≥5M spans (a main-thread-bound renderer can spend hundreds of ms *inside one frame callback* at that scale — full frame counts there would take many minutes per cell and risk the browser's own page-unresponsive hang detector). 3 runs per cell; p50/p95/p99/worst reported per PLAN.md §20.1 (never the mean) — p99 at the largest sizes is backed by too few samples to trust as tightly as the smaller-size rows; `worst` and dropped-frame count are the run-level max/sum across the 3 runs, not averaged.
- Dropped frame: rAF delta > 1.5× a fixed 60Hz (16.6ms) reference interval — fixed, not adaptive to the actual display refresh rate, so numbers stay comparable across machines.
- "Upload" is wall-clock ms for the renderer's initial data upload (DOM/Canvas2D: building the pooled elements / colour buckets; WebGL2: `bufferData` + `gl.finish()`; WebGPU: `ingestSpans` + the component's first `update()` + one submitted frame).

**Not yet measured** (see the migration plan / README for why): Firefox, WebKit, Safari; multiple hardware tiers (this is one machine, one tier, reported as such); the software-renderer correctness-snapshot environment; interaction latency; CPU/GPU memory accounting. These are real gaps, not numbers this report is claiming.

## Skipped cells

- **dom** @ 100,000 spans (shallow-wide): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 1,000,000 spans (shallow-wide): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 5,000,000 spans (shallow-wide): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 10,000,000 spans (shallow-wide): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 100,000 spans (deep-nested): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 1,000,000 spans (deep-nested): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 5,000,000 spans (deep-nested): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 10,000,000 spans (deep-nested): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 100,000 spans (bursty): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 1,000,000 spans (bursty): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 5,000,000 spans (bursty): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")
- **dom** @ 10,000,000 spans (bursty): dom is capped at 20,000 spans (see PLAN.md §20.3: "unusable above ~10k")

## Phase 0 goal (a): shared context vs. independent devices

See `decision-record.md` for the full canvas-per-component-vs-mega-canvas writeup, including the 2026-08-30 root-cause fix (the original scenario measured bare `requestAnimationFrame` cadence, not scheduling/submit overhead — a harness bug, not an architecture finding) and the round-2 methodology: each component carries a small real span payload and is driven every measured frame through an oscillating-viewport `update()` (real work, never a cached repaint), scaling component count higher, since fixed per-device/per-submit overhead — not GPU compute/render cost — is the thing this scenario is actually trying to isolate. One shared `GpuRuntime` (N components, 1 device, 1 submit/tick) vs. N fully independent `GpuRuntime`s (N devices, N submits/tick).

| Components (N) | Configuration | p50 (ms) | p95 (ms) | worst (ms) | dropped |
| ---: | --- | ---: | ---: | ---: | ---: |
| 2 | Shared `GpuRuntime` (1 device, 1 submit) | 16.700 | 16.700 | 16.800 | 0 |
| 2 | Independent `GpuRuntime`s (2 devices) | 16.700 | 16.800 | 16.800 | 0 |
| 8 | Shared `GpuRuntime` (1 device, 1 submit) | 16.700 | 16.800 | 16.800 | 0 |
| 8 | Independent `GpuRuntime`s (8 devices) | 16.700 | 16.700 | 16.800 | 0 |
| 16 | Shared `GpuRuntime` (1 device, 1 submit) | 16.700 | 16.700 | 16.800 | 0 |
| 16 | Independent `GpuRuntime`s (16 devices) | 16.700 | 16.700 | 16.800 | 0 |
| 24 | Shared `GpuRuntime` (1 device, 1 submit) | 16.700 | 16.800 | 16.800 | 0 |
| 24 | Independent `GpuRuntime`s (24 devices) | 16.700 | 16.800 | 16.800 | 0 |

**N=2: tied** — both configurations land on the same rounded p50, consistent with both still being bound by the display's vsync interval rather than by actual scheduling/submit cost at this component count. Not a confirmation or a contradiction of the architectural bet; it means this measurement has no signal here.
**N=8: tied** — both configurations land on the same rounded p50, consistent with both still being bound by the display's vsync interval rather than by actual scheduling/submit cost at this component count. Not a confirmation or a contradiction of the architectural bet; it means this measurement has no signal here.
**N=16: tied** — both configurations land on the same rounded p50, consistent with both still being bound by the display's vsync interval rather than by actual scheduling/submit cost at this component count. Not a confirmation or a contradiction of the architectural bet; it means this measurement has no signal here.
**N=24: tied** — both configurations land on the same rounded p50, consistent with both still being bound by the display's vsync interval rather than by actual scheduling/submit cost at this component count. Not a confirmation or a contradiction of the architectural bet; it means this measurement has no signal here.

## Phase 0 goal (a), round 3: real GPU timing (the Profiler)

The rounds above (`decision-record.md`) concluded that `requestAnimationFrame`-interval measurement has a hard floor at the display's vsync rate and cannot show a sub-vsync difference — the fix was to build the Phase 4 `Profiler` (real `timer(gpu)` GPU timing) and measure with it directly instead. This table is that measurement: mean total GPU milliseconds per tick (summed across every mounted component's passes), not wall-clock time between frames. Same workload as the earlier rounds (`gpuTimingScenario.ts` reuses `sharedContextScenario.ts`'s payload/drive helpers) — same real span payload, same oscillating-viewport drive pattern, measured a different way.

| Components (N) | Shared GPU ms/tick | Independent GPU ms/tick | Ratio (independent/shared) |
| ---: | ---: | ---: | ---: |
| 2 | 0.0654 | 0.1080 | 1.65× |
| 8 | 0.3039 | 0.6064 | 2.00× |
| 16 | 0.5540 | 1.3893 | 2.51× |
| 24 | 0.7504 | 1.1991 | 1.60× |

**Confirms the architectural bet.** At N=2 the two are within noise of each other (both configurations' per-tick GPU cost is tiny relative to measurement variance). From N=8 onward the shared runtime consistently costs meaningfully less real GPU time per tick than N independent devices doing the same aggregate work — reproduced consistently across repeated runs, not a one-off. The ratio is not perfectly monotonic (observed, reproducible: it widens from N=8 to N=16, then narrows somewhat at N=24 — recorded honestly rather than smoothed over; the cause hasn't been investigated, could be driver/OS-level batching behavior at higher device counts on this specific machine). This is the first round of this investigation with a real answer, not an inconclusive one.

## shallow-wide

Canvas2D → WebGPU crossover at or before **100,000 spans** (shallow-wide): Canvas2D p50 16.70ms vs WebGPU p50 16.70ms.

| Spans | Renderer | p50 (ms) | p95 (ms) | p99 (ms) | worst (ms) | dropped | upload (ms) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | canvas2d | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 0.20 |
| 1,000 | dom | 16.70 | 16.77 | 16.80 | 16.80 | 0 | 1.10 |
| 1,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 6.40 |
| 1,000 | webgpu | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 25.00 |
| 10,000 | canvas2d | 16.70 | 16.70 | 16.80 | 16.80 | 0 | 0.30 |
| 10,000 | dom | 94.43 | 361.10 | 488.87 | 633.20 | 897 | 12.50 |
| 10,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 4.60 |
| 10,000 | webgpu | 16.70 | 16.73 | 16.80 | 33.40 | 1 | 23.10 |
| 100,000 | canvas2d | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 0.90 |
| 100,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 100,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 4.30 |
| 100,000 | webgpu | 16.70 | 16.77 | 16.80 | 16.80 | 0 | 38.70 |
| 1,000,000 | canvas2d | 183.37 | 216.67 | 222.23 | 233.40 | 300 | 3.60 |
| 1,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 1,000,000 | webgl2 | 16.70 | 16.77 | 16.80 | 16.80 | 0 | 6.80 |
| 1,000,000 | webgpu | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 452.70 |
| 5,000,000 | canvas2d | 1016.63 | 1072.20 | 1088.90 | 1100.00 | 120 | 16.00 |
| 5,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 5,000,000 | webgl2 | 66.70 | 83.33 | 83.43 | 83.50 | 120 | 24.10 |
| 5,000,000 | webgpu | 27.70 | 33.40 | 33.40 | 33.40 | 58 | 2864.60 |
| 10,000,000 | canvas2d | 2055.50 | 2155.47 | 2166.63 | 2166.70 | 120 | 39.70 |
| 10,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 10,000,000 | webgl2 | 144.47 | 150.03 | 150.07 | 150.10 | 120 | 50.30 |
| 10,000,000 | webgpu | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 8033.20 |

## deep-nested

Canvas2D → WebGPU crossover at or before **1,000,000 spans** (deep-nested): Canvas2D p50 183.30ms vs WebGPU p50 16.70ms.

| Spans | Renderer | p50 (ms) | p95 (ms) | p99 (ms) | worst (ms) | dropped | upload (ms) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | canvas2d | 16.70 | 16.70 | 16.80 | 16.80 | 0 | 0.20 |
| 1,000 | dom | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 1.50 |
| 1,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 13.40 |
| 1,000 | webgpu | 16.70 | 16.70 | 16.80 | 16.80 | 0 | 26.90 |
| 10,000 | canvas2d | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 0.30 |
| 10,000 | dom | 49.97 | 66.70 | 66.70 | 66.80 | 769 | 12.30 |
| 10,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 4.80 |
| 10,000 | webgpu | 16.70 | 16.77 | 16.80 | 16.80 | 0 | 21.60 |
| 100,000 | canvas2d | 16.70 | 16.77 | 16.80 | 16.80 | 0 | 1.00 |
| 100,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 100,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 4.30 |
| 100,000 | webgpu | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 30.60 |
| 1,000,000 | canvas2d | 183.30 | 216.70 | 233.27 | 233.30 | 300 | 3.40 |
| 1,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 1,000,000 | webgl2 | 16.70 | 16.77 | 16.77 | 16.80 | 0 | 6.90 |
| 1,000,000 | webgpu | 16.70 | 16.70 | 16.77 | 16.80 | 0 | 458.50 |
| 5,000,000 | canvas2d | 1055.47 | 1100.03 | 1144.40 | 1199.90 | 120 | 14.80 |
| 5,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 5,000,000 | webgl2 | 83.30 | 99.93 | 100.00 | 100.00 | 120 | 24.40 |
| 5,000,000 | webgpu | 50.03 | 88.87 | 88.93 | 100.10 | 100 | 3049.70 |
| 10,000,000 | canvas2d | 2122.13 | 2183.23 | 2194.43 | 2200.00 | 120 | 40.00 |
| 10,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 10,000,000 | webgl2 | 166.70 | 183.33 | 183.40 | 183.40 | 120 | 60.60 |
| 10,000,000 | webgpu | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 8327.80 |

## bursty

Canvas2D → WebGPU crossover at or before **10,000 spans** (bursty): Canvas2D p50 16.70ms vs WebGPU p50 16.70ms.

| Spans | Renderer | p50 (ms) | p95 (ms) | p99 (ms) | worst (ms) | dropped | upload (ms) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | canvas2d | 16.70 | 16.70 | 16.80 | 16.80 | 0 | 0.10 |
| 1,000 | dom | 16.70 | 16.73 | 16.80 | 33.30 | 1 | 1.30 |
| 1,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 13.40 |
| 1,000 | webgpu | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 28.10 |
| 10,000 | canvas2d | 16.70 | 16.70 | 16.80 | 33.30 | 1 | 0.30 |
| 10,000 | dom | 83.27 | 333.23 | 438.90 | 566.60 | 896 | 12.70 |
| 10,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 4.90 |
| 10,000 | webgpu | 16.70 | 16.70 | 16.80 | 16.80 | 0 | 26.60 |
| 100,000 | canvas2d | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 0.90 |
| 100,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 100,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 4.20 |
| 100,000 | webgpu | 16.70 | 16.77 | 16.80 | 16.80 | 0 | 40.70 |
| 1,000,000 | canvas2d | 199.97 | 233.40 | 233.40 | 233.50 | 300 | 3.30 |
| 1,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 1,000,000 | webgl2 | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 7.00 |
| 1,000,000 | webgpu | 16.70 | 16.73 | 16.80 | 16.80 | 0 | 488.50 |
| 5,000,000 | canvas2d | 1094.33 | 1144.37 | 1149.93 | 1166.60 | 120 | 15.00 |
| 5,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 5,000,000 | webgl2 | 83.30 | 83.40 | 83.40 | 83.40 | 120 | 35.30 |
| 5,000,000 | webgpu | 44.47 | 50.10 | 50.10 | 50.10 | 120 | 2989.20 |
| 10,000,000 | canvas2d | 2188.80 | 2266.60 | 2299.87 | 2333.10 | 120 | 34.20 |
| 10,000,000 | dom | skipped | skipped | skipped | skipped | — | — |
| 10,000,000 | webgl2 | 150.00 | 166.67 | 366.70 | 466.70 | 117 | 60.40 |
| 10,000,000 | webgpu | 16.70 | 16.77 | 16.77 | 16.80 | 0 | 8310.70 |
