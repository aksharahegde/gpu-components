import { test, expect, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../src/harness/report.ts";
import type { BenchReport, RendererId, RunResult, Shape } from "../src/types.ts";
import { RENDERERS, SHAPES, SIZES } from "../src/types.ts";
import type { RunOptions } from "../src/harness/runner.ts";
import type { SharedContextResult } from "../src/harness/sharedContextScenario.ts";
import type { GpuTimingResult } from "../src/harness/gpuTimingScenario.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.resolve(__dirname, "../results");

const QUICK = process.env.BENCH_QUICK === "1";
const sizes = QUICK ? [1_000, 10_000] : SIZES;
const shapes = QUICK ? (["bursty"] as const) : SHAPES;
const quickOpts: Partial<RunOptions> = QUICK ? { runs: 1, warmupFrames: 20, measuredFrames: 40 } : {};

/**
 * At large N, a main-thread-bound renderer (Canvas2D, DOM) can spend hundreds of ms *inside a
 * single frame callback* — 300 measured + 200 warmup frames at that pace would make one cell take
 * many minutes and risks Chromium's own page-unresponsive hang detector. Frame counts scale down
 * for large sizes; still enough samples for a real p50/p95, nowhere near enough for a stable p99 —
 * `BASELINES.md`'s methodology section says so rather than presenting it as full-strength.
 */
function optionsFor(size: number): Partial<RunOptions> {
  if (QUICK) return quickOpts;
  if (size >= 5_000_000) return { runs: 3, warmupFrames: 20, measuredFrames: 40 };
  if (size >= 1_000_000) return { runs: 3, warmupFrames: 50, measuredFrames: 100 };
  return {};
}

test.describe.configure({ mode: "serial" });

/**
 * Retries `page.goto` a few times with a short backoff. Observed in practice: after a large-N
 * cell crashes the Chromium renderer, the very next reload can hit `ERR_CONNECTION_REFUSED` —
 * the Vite dev server transiently isn't accepting connections yet, not permanently dead. A short
 * retry survives that without needing to restart the whole matrix run by hand.
 */
async function gotoWithRetry(page: Page, url: string, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(url);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

test("benchmark matrix", async ({ page }) => {
  test.setTimeout(0); // this test's own duration is the whole point — no per-test cap

  const results: RunResult[] = [];
  let userAgent = "";

  function writeResults(sharedContext: SharedContextResult | null, gpuTiming: GpuTimingResult | null) {
    const report: BenchReport = { generatedAt: new Date().toISOString(), userAgent, results };
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(
      path.join(RESULTS_DIR, "baselines.json"),
      JSON.stringify({ report, sharedContext, gpuTiming }, null, 2),
    );
    writeFileSync(path.join(RESULTS_DIR, "BASELINES.md"), renderMarkdown(report, sharedContext, shapes, gpuTiming));
  }

  for (const shape of shapes as readonly Shape[]) {
    for (const size of sizes) {
      for (const renderer of RENDERERS as readonly RendererId[]) {
        // Fresh page per cell: a long-lived tab accumulates GPU/DOM/canvas memory across 60+
        // cells, and a large-N Canvas2D/DOM cell alone can push it over the edge (observed:
        // Chromium's renderer process died mid-run with "Execution context was destroyed"). A
        // reload is cheap next to what a large cell itself costs, and it means one cell crashing
        // doesn't take the whole matrix down with it — results are also written after every cell,
        // not just at the end, so a genuine crash still leaves real partial data on disk. The
        // whole cell (goto included, not just the measurement) is inside the try/catch — an
        // earlier version only wrapped `page.evaluate`, so a `page.goto` failure (observed:
        // `ERR_CONNECTION_REFUSED` right after a crash) still took the entire run down.
        let result: RunResult;
        try {
          await gotoWithRetry(page, "/index.html");
          await page.waitForFunction(() => "__bench" in window);
          if (!userAgent) userAgent = await page.evaluate(() => navigator.userAgent);
          result = await page.evaluate(
            ([r, s, n, opts]) =>
              window.__bench.runCell(r as RendererId, s as Shape, n as number, opts as Partial<RunOptions>),
            [renderer, shape, size, optionsFor(size)] as const,
          );
        } catch (err) {
          result = {
            renderer,
            shape,
            size,
            stats: null,
            skippedReason: `crashed: ${err instanceof Error ? err.message : String(err)}`,
            uploadMs: null,
            runs: [],
          };
        }
        results.push(result);
        const status = result.stats
          ? `p50=${result.stats.p50.toFixed(2)}ms p95=${result.stats.p95.toFixed(2)}ms`
          : `skipped (${result.skippedReason})`;
        console.log(`  ${shape}/${renderer}/${size.toLocaleString("en-US")}: ${status}`);
        writeResults(null, null); // no shared-context/gpu-timing numbers yet — refreshed below
      }
    }
  }

  await gotoWithRetry(page, "/index.html");
  await page.waitForFunction(() => "__bench" in window);
  const sharedContext: SharedContextResult = await page.evaluate(() => window.__bench.runSharedContext());
  writeResults(sharedContext, null);

  await gotoWithRetry(page, "/index.html");
  await page.waitForFunction(() => "__bench" in window);
  const gpuTiming: GpuTimingResult = await page.evaluate(() => window.__bench.runGpuTiming());
  writeResults(sharedContext, gpuTiming);

  expect(results.length).toBeGreaterThan(0);
});
