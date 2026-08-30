import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../src/harness/report.ts";
import type { BenchReport, RendererId, RunResult, Shape } from "../src/types.ts";
import { RENDERERS, SHAPES, SIZES } from "../src/types.ts";
import type { RunOptions } from "../src/harness/runner.ts";
import type { SharedContextResult } from "../src/harness/sharedContextScenario.ts";

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

test("benchmark matrix", async ({ page }) => {
  test.setTimeout(0); // this test's own duration is the whole point — no per-test cap
  await page.goto("/index.html");
  await page.waitForFunction(() => "__bench" in window);

  const results: RunResult[] = [];
  for (const shape of shapes as readonly Shape[]) {
    for (const size of sizes) {
      for (const renderer of RENDERERS as readonly RendererId[]) {
        const result = await page.evaluate(
          ([r, s, n, opts]) => window.__bench.runCell(r as RendererId, s as Shape, n as number, opts as Partial<RunOptions>),
          [renderer, shape, size, optionsFor(size)] as const,
        );
        results.push(result);
        const status = result.stats
          ? `p50=${result.stats.p50.toFixed(2)}ms p95=${result.stats.p95.toFixed(2)}ms`
          : `skipped (${result.skippedReason})`;
        console.log(`  ${shape}/${renderer}/${size.toLocaleString("en-US")}: ${status}`);
      }
    }
  }

  const sharedContext: SharedContextResult = await page.evaluate(() => window.__bench.runSharedContext());

  const userAgent = await page.evaluate(() => navigator.userAgent);
  const report: BenchReport = { generatedAt: new Date().toISOString(), userAgent, results };

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, "baselines.json"), JSON.stringify({ report, sharedContext }, null, 2));
  writeFileSync(path.join(RESULTS_DIR, "BASELINES.md"), renderMarkdown(report, sharedContext, shapes));

  expect(results.length).toBeGreaterThan(0);
});
