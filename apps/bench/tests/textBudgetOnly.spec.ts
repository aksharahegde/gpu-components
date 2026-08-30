import { test } from "@playwright/test";
import type { TextBudgetResult } from "../src/harness/textBudgetScenario.ts";

/**
 * The grid text spike (PLAN.md §13.4 / §30 risk 2): does `GPUDataGrid` need a glyph atlas, or does
 * a DOM or Canvas2D text layer sustain ~2,400 cells? Writes the numbers `spikes/grid-text-budget.md`
 * is built from. Not part of the `npm run bench` matrix — run it deliberately.
 */
test("text budget scenario measures all three strategies", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/index.html");
  await page.waitForFunction(() => "__bench" in window);
  const result: TextBudgetResult = await page.evaluate(() => window.__bench.runTextBudget());
  for (const run of result) {
    console.log(
      `${run.cells}\t${run.strategy}\tp50=${run.cpuMs.p50.toFixed(3)}ms\tp95=${run.cpuMs.p95.toFixed(3)}ms\t` +
        `p99=${run.cpuMs.p99.toFixed(3)}ms\tworst=${run.cpuMs.worst.toFixed(3)}ms\tdropped=${run.droppedFrames}`,
    );
  }
});
