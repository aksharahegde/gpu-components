import { test } from "@playwright/test";

/**
 * Standalone verification for gpuTimingScenario.ts (Round 3 of the shared-vs-independent-device
 * investigation) — runs just this scenario, not the full render matrix, so it finishes quickly.
 * Not part of the regular `npm run bench` matrix; delete once the approach is trusted, or keep as a
 * fast smoke check.
 */
test("gpu timing scenario runs and produces real per-frame GPU ms", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/index.html");
  await page.waitForFunction(() => "__bench" in window);
  const result = await page.evaluate(() => window.__bench.runGpuTiming());
  for (const run of result as unknown as Array<Record<string, unknown>>) {
    console.log(`N=${run.componentCount as number}`, JSON.stringify(run));
  }
});
