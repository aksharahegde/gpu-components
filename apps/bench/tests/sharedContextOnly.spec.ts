import { test } from "@playwright/test";
import { NO_WEBGPU_REASON, webgpuAvailable } from "./webgpuAvailable.ts";
import type { SharedContextResult } from "../src/harness/sharedContextScenario.ts";

/**
 * Standalone verification for the `sharedContextScenario.ts` root-cause fix (2026-08-30) — runs
 * only the Phase 0 goal (a) shared-vs-independent-device comparison, not the full render matrix, so
 * it finishes in seconds instead of the minutes the full `bench.spec.ts` run takes. Not part of the
 * regular `npm run bench` matrix; delete once the fix is trusted, or keep as a fast smoke check.
 */
test("shared context scenario runs and produces stats for both configurations", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/index.html");
  test.skip(!(await webgpuAvailable(page)), NO_WEBGPU_REASON);
  await page.waitForFunction(() => "__bench" in window);
  const result: SharedContextResult = await page.evaluate(() => window.__bench.runSharedContext());
  for (const run of result) {
    console.log(`N=${run.componentCount} shared:`, JSON.stringify(run.sharedRuntime));
    console.log(
      `N=${run.componentCount} independent:`,
      run.independentRuntimes ? JSON.stringify(run.independentRuntimes) : `skipped (${run.independentSkippedReason})`,
    );
  }
});
