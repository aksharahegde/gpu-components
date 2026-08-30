import { test } from "@playwright/test";
import type { LogTextResult } from "../src/harness/logTextScenario.ts";

/**
 * The log-viewer text spike (PLAN.md §12.1's fourth primitive / §30 risk 2): does `GPULogViewer`
 * justify a glyph atlas, given `spikes/grid-text-budget.md` found that `GPUDataGrid` did not?
 * Writes the numbers `spikes/log-text-budget.md` is built from. Not part of the `npm run bench`
 * matrix — run it deliberately.
 */
test("log text scenario measures all three strategies", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/index.html");
  await page.waitForFunction(() => "__bench" in window);
  const result: LogTextResult = await page.evaluate(() => window.__bench.runLogText());
  for (const run of result) {
    console.log(
      `${run.lines}\t${run.strategy}\tglyphs=${run.glyphs}\tcalls=${run.textCalls}\t` +
        `p50=${run.cpuMs.p50.toFixed(3)}ms\tp95=${run.cpuMs.p95.toFixed(3)}ms\t` +
        `p99=${run.cpuMs.p99.toFixed(3)}ms\tworst=${run.cpuMs.worst.toFixed(3)}ms\tdropped=${run.droppedFrames}`,
    );
  }
});
