import { test, expect } from "@playwright/test";
import { NO_WEBGPU_REASON, webgpuAvailable } from "./webgpuAvailable.ts";

/**
 * Real-browser gate for `GraphComponent`'s animation (HANDOFF.md §5): a green unit-test suite
 * proves the layout's math is correct against a manually-ticked mock GPU, but says nothing about
 * whether a real `requestAnimationFrame`-driven `FrameScheduler` loop ever reaches it. This is that
 * proof — see this repo's own culture on the point, HANDOFF.md §4 ("a green test suite does not
 * mean it renders").
 *
 * Two halves, both required:
 *  - the canvas visibly changes frame-to-frame while the layout is still settling (the bug this
 *    guards against: rendering exactly once and then silently going inert forever);
 *  - the canvas stops changing once the simulation converges (`MAX_ITERATIONS = 600` in
 *    `registry/graph/GraphComponent.ts`) — proving it correctly stops, not just that a naive
 *    "always keep re-rendering" fix would pass the first half.
 */
test("GPUGraph animates while settling, then stops once converged", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/index.html");
  test.skip(!(await webgpuAvailable(page)), NO_WEBGPU_REASON);

  await page.waitForFunction(() => "__bench" in window);
  await page.evaluate(() => window.__bench.runGraphAnimation());

  const canvas = page.locator("#graph-canvas");
  await expect(canvas).toBeVisible();

  // Give the simulation a moment to actually start moving off its seed layout.
  await page.waitForTimeout(500);
  const early1 = await canvas.screenshot();
  await page.waitForTimeout(500);
  const early2 = await canvas.screenshot();
  expect(early1.equals(early2)).toBe(false);

  // MAX_ITERATIONS = 600 in GraphComponent, one iteration per active tick at up to 60fps — 10s of
  // real time is the fastest it could converge; give it a comfortable margin above that.
  await page.waitForTimeout(14_000);
  const settled1 = await canvas.screenshot();
  await page.waitForTimeout(1_000);
  const settled2 = await canvas.screenshot();
  expect(settled1.equals(settled2)).toBe(true);
});
