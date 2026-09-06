import { test } from "@playwright/test";
import type { TextBudgetResult } from "../src/harness/textBudgetScenario.ts";

/**
 * The grid text spike (PLAN.md §13.4 / §30 risk 2): does `GPUDataGrid` need a glyph atlas, or does
 * a DOM or Canvas2D text layer sustain ~2,400 cells? Writes the numbers `spikes/grid-text-budget.md`
 * is built from. Not part of the `npm run bench` matrix — run it deliberately.
 */
test("text budget scenario measures all three strategies", async ({ page }) => {
  // 300s was tuned on a developer machine and left almost no margin on CI hardware: this spec
  // measured 4.3m against its 5m cap on one run and exceeded it on the next, without the spec
  // itself changing. Raised rather than left to flake — Playwright's own per-test cap in
  // playwright.config.ts is 15m, so this stays well inside it.
  test.setTimeout(600_000);
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
