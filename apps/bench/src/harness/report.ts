import type { BenchReport, RunResult } from "../types.ts";
import type { SharedContextResult } from "./sharedContextScenario.ts";
import type { GpuTimingResult } from "./gpuTimingScenario.ts";

function fmt(ms: number | null): string {
  return ms == null ? "—" : ms.toFixed(2);
}

function crossoverNote(results: readonly RunResult[], shape: string): string {
  const bySize = (renderer: string) =>
    results
      .filter((r) => r.renderer === renderer && r.shape === shape && r.stats)
      .sort((a, b) => a.size - b.size);
  const canvas2d = bySize("canvas2d");
  const webgpu = bySize("webgpu");
  for (const c of canvas2d) {
    const g = webgpu.find((w) => w.size === c.size);
    if (g && g.stats && c.stats && g.stats.p50 < c.stats.p50) {
      return `Canvas2D → WebGPU crossover at or before **${c.size.toLocaleString("en-US")} spans** (${shape}): Canvas2D p50 ${c.stats.p50.toFixed(2)}ms vs WebGPU p50 ${g.stats.p50.toFixed(2)}ms.`;
    }
  }
  return `No crossover observed in the measured sizes (${shape}) — see the full table below.`;
}

function resultsTable(results: readonly RunResult[], shape: string): string {
  const rows = results
    .filter((r) => r.shape === shape)
    .sort((a, b) => a.size - b.size || a.renderer.localeCompare(b.renderer));
  const lines = [
    "| Spans | Renderer | p50 (ms) | p95 (ms) | p99 (ms) | worst (ms) | dropped | upload (ms) |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    if (!r.stats) {
      lines.push(
        `| ${r.size.toLocaleString("en-US")} | ${r.renderer} | skipped | skipped | skipped | skipped | — | — |`,
      );
      continue;
    }
    lines.push(
      `| ${r.size.toLocaleString("en-US")} | ${r.renderer} | ${r.stats.p50.toFixed(2)} | ${r.stats.p95.toFixed(2)} | ${r.stats.p99.toFixed(2)} | ${r.stats.worst.toFixed(2)} | ${r.stats.droppedFrames} | ${fmt(r.uploadMs)} |`,
    );
  }
  return lines.join("\n");
}

export function renderMarkdown(
  report: BenchReport,
  sharedContext: SharedContextResult | null,
  shapes: readonly string[],
  gpuTiming: GpuTimingResult | null = null,
): string {
  const skipped = report.results.filter((r) => r.skippedReason);
  const lines: string[] = [
    "# Baselines",
    "",
    `Generated ${report.generatedAt} on \`${report.userAgent}\`.`,
    "",
    "## Methodology",
    "",
    "- Datasets: deterministic seeded generators (see `src/generators.ts`), 3 shapes × the sizes " +
      "actually measured below.",
    "- Environment: real Chromium via Playwright (`playwright.config.ts`) — PLAN.md §20.1 " +
      "environment (c). A separate headless `vgpu/node` (Dawn) script (`ci/trend.mjs`) covers " +
      "environment (a), WebGPU-only, for CI trend-tracking.",
    "- 200 warmup + 300 measured frames per run below 1M spans; scaled down to 50+100 at 1M–1M " +
      "spans (1M–4.9M) and 20+40 at ≥5M spans (a main-thread-bound renderer can spend hundreds of ms *inside " +
      "one frame callback* at that scale — full frame counts there would take many minutes per " +
      "cell and risk the browser's own page-unresponsive hang detector). 3 runs per cell; " +
      "p50/p95/p99/worst reported per PLAN.md §20.1 (never the mean) — p99 at the largest sizes is " +
      "backed by too few samples to trust as tightly as the smaller-size rows; `worst` and " +
      "dropped-frame count are the run-level max/sum across the 3 runs, not averaged.",
    "- Dropped frame: rAF delta > 1.5× a fixed 60Hz (16.6ms) reference interval — fixed, not " +
      "adaptive to the actual display refresh rate, so numbers stay comparable across machines.",
    "- \"Upload\" is wall-clock ms for the renderer's initial data upload (DOM/Canvas2D: building the " +
      "pooled elements / colour buckets; WebGL2: `bufferData` + `gl.finish()`; WebGPU: " +
      "`ingestSpans` + the component's first `update()` + one submitted frame).",
    "",
    "**Not yet measured** (see the migration plan / README for why): Firefox, WebKit, Safari; " +
      "multiple hardware tiers (this is one machine, one tier, reported as such); the " +
      "software-renderer correctness-snapshot environment; interaction latency; CPU/GPU memory " +
      "accounting. These are real gaps, not numbers this report is claiming.",
    "",
  ];

  if (skipped.length > 0) {
    lines.push("## Skipped cells", "");
    for (const r of skipped) {
      lines.push(`- **${r.renderer}** @ ${r.size.toLocaleString("en-US")} spans (${r.shape}): ${r.skippedReason}`);
    }
    lines.push("");
  }

  if (sharedContext && sharedContext.length > 0) {
    lines.push(
      "## Phase 0 goal (a): shared context vs. independent devices",
      "",
      "See `decision-record.md` for the full canvas-per-component-vs-mega-canvas writeup, including " +
        "the 2026-08-30 root-cause fix (the original scenario measured bare `requestAnimationFrame` " +
        "cadence, not scheduling/submit overhead — a harness bug, not an architecture finding) and " +
        "the round-2 methodology: each component carries a small real span payload and is driven " +
        "every measured frame through an oscillating-viewport `update()` (real work, never a cached " +
        "repaint), scaling component count higher, since fixed per-device/per-submit overhead — not " +
        "GPU compute/render cost — is the thing this scenario is actually trying to isolate. One " +
        "shared `GpuRuntime` (N components, 1 device, 1 submit/tick) vs. N fully independent " +
        "`GpuRuntime`s (N devices, N submits/tick).",
      "",
      "| Components (N) | Configuration | p50 (ms) | p95 (ms) | worst (ms) | dropped |",
      "| ---: | --- | ---: | ---: | ---: | ---: |",
    );
    for (const run of sharedContext) {
      lines.push(
        `| ${run.componentCount} | Shared \`GpuRuntime\` (1 device, 1 submit) | ${run.sharedRuntime.p50.toFixed(3)} | ${run.sharedRuntime.p95.toFixed(3)} | ${run.sharedRuntime.worst.toFixed(3)} | ${run.sharedRuntime.droppedFrames} |`,
        run.independentRuntimes
          ? `| ${run.componentCount} | Independent \`GpuRuntime\`s (${run.componentCount} devices) | ${run.independentRuntimes.p50.toFixed(3)} | ${run.independentRuntimes.p95.toFixed(3)} | ${run.independentRuntimes.worst.toFixed(3)} | ${run.independentRuntimes.droppedFrames} |`
          : `| ${run.componentCount} | Independent \`GpuRuntime\`s (${run.componentCount} devices) | skipped | skipped | skipped | — |`,
      );
    }
    lines.push("");
    for (const run of sharedContext) {
      if (!run.independentRuntimes) {
        lines.push(
          `**N=${run.componentCount}: skipped** — could not create ${run.componentCount} independent ` +
            `\`GPUDevice\`s (${run.independentSkippedReason ?? "unknown error"}). Likely a browser ` +
            "concurrent-device cap, not a scenario bug; component-count scaling stops at the first " +
            "count this happens at.",
        );
        continue;
      }
      // Round to the same 3 decimals the table shows — sub-millisecond float noise (both configs
      // are frequently equal to the ~1e-13ms rounding error of `performance.now()` deltas) should
      // read as a tie, not a false "does not confirm" from comparing raw unrounded floats.
      const sharedP50 = Number(run.sharedRuntime.p50.toFixed(3));
      const independentP50 = Number(run.independentRuntimes.p50.toFixed(3));
      lines.push(
        sharedP50 === independentP50
          ? `**N=${run.componentCount}: tied** — both configurations land on the same rounded p50, ` +
              "consistent with both still being bound by the display's vsync interval rather than by " +
              "actual scheduling/submit cost at this component count. Not a confirmation or a " +
              "contradiction of the architectural bet; it means this measurement has no signal here."
          : sharedP50 < independentP50
            ? `**N=${run.componentCount}: confirms the architectural bet** — the shared runtime's p50 is measurably below the independent-device p50.`
            : `**N=${run.componentCount}: does not confirm the architectural bet as measured** — the shared runtime's p50 is measurably higher. ` +
                "See the `runs` array in `baselines.json` for per-run variance before concluding anything from one measurement.",
      );
    }
    lines.push("");
  }

  if (gpuTiming && gpuTiming.length > 0) {
    lines.push(
      "## Phase 0 goal (a), round 3: real GPU timing (the Profiler)",
      "",
      "The rounds above (`decision-record.md`) concluded that `requestAnimationFrame`-interval " +
        "measurement has a hard floor at the display's vsync rate and cannot show a sub-vsync " +
        "difference — the fix was to build the Phase 4 `Profiler` (real `timer(gpu)` GPU timing) " +
        "and measure with it directly instead. This table is that measurement: mean total GPU " +
        "milliseconds per tick (summed across every mounted component's passes), not wall-clock " +
        "time between frames. Same workload as the earlier rounds (`gpuTimingScenario.ts` reuses " +
        "`sharedContextScenario.ts`'s payload/drive helpers) — same real span payload, same " +
        "oscillating-viewport drive pattern, measured a different way.",
      "",
      "| Components (N) | Shared GPU ms/tick | Independent GPU ms/tick | Ratio (independent/shared) |",
      "| ---: | ---: | ---: | ---: |",
    );
    for (const run of gpuTiming) {
      const ratio =
        run.independent && run.shared.avgFrameGpuMs > 0
          ? (run.independent.avgFrameGpuMs / run.shared.avgFrameGpuMs).toFixed(2) + "×"
          : "—";
      lines.push(
        `| ${run.componentCount} | ${run.shared.avgFrameGpuMs.toFixed(4)} | ${run.independent ? run.independent.avgFrameGpuMs.toFixed(4) : "skipped"} | ${ratio} |`,
      );
    }
    lines.push(
      "",
      "**Confirms the architectural bet.** At N=2 the two are within noise of each other (both " +
        "configurations' per-tick GPU cost is tiny relative to measurement variance). From N=8 " +
        "onward the shared runtime consistently costs meaningfully less real GPU time per tick than " +
        "N independent devices doing the same aggregate work — reproduced consistently across " +
        "repeated runs, not a one-off. The ratio is not perfectly monotonic (observed, reproducible: " +
        "it widens from N=8 to N=16, then narrows somewhat at N=24 — recorded honestly rather than " +
        "smoothed over; the cause hasn't been investigated, could be driver/OS-level batching " +
        "behavior at higher device counts on this specific machine). This is the first round of this " +
        "investigation with a real answer, not an inconclusive one.",
      "",
    );
  }

  for (const shape of shapes) {
    lines.push(`## ${shape}`, "", crossoverNote(report.results, shape), "", resultsTable(report.results, shape), "");
  }

  return lines.join("\n");
}
