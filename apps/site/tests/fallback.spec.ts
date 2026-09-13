import { test, expect } from "@playwright/test";

/**
 * PLAN.md §22, stage 5.4 — real-browser verification of the Canvas2D fallback. A green test suite
 * elsewhere in this repo does not mean it renders (HANDOFF.md §4); this is the check that actually
 * gates "done" for this feature.
 *
 * `navigator.gpu` is deleted via `addInitScript`, BEFORE navigation — deterministic and
 * headless/headed-identical, unlike `--disable-features=WebGPU`, which can leave `navigator.gpu`
 * partly present on some Chromium builds.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { get: () => undefined, configurable: true });
  });
});

const CLEAR_RGB: readonly [number, number, number] = [247, 251, 253]; // apps/site's color.bgRaised
const CLEAR_TOLERANCE = 4;

function isClear(r: number, g: number, b: number): boolean {
  return (
    Math.abs(r - CLEAR_RGB[0]) <= CLEAR_TOLERANCE &&
    Math.abs(g - CLEAR_RGB[1]) <= CLEAR_TOLERANCE &&
    Math.abs(b - CLEAR_RGB[2]) <= CLEAR_TOLERANCE
  );
}

interface PixelSummary {
  readonly width: number;
  readonly height: number;
  readonly nonClearCount: number;
  readonly distinctColors: number;
  /** Number of clear->non-clear transitions along the vertical-middle scanline — proves
   * individually-shaped spans exist rather than one smear or a single giant rect. */
  readonly transitions: number;
}

async function readCanvasPixels(page: import("@playwright/test").Page): Promise<PixelSummary> {
  return page.evaluate(([clearR, clearG, clearB, tol]) => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas found on the page");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas has no 2d context — is the fallback actually engaged?");
    const { width, height } = canvas;
    const { data } = ctx.getImageData(0, 0, width, height);

    const isClearPx = (i: number) =>
      Math.abs(data[i]! - clearR) <= tol && Math.abs(data[i + 1]! - clearG) <= tol && Math.abs(data[i + 2]! - clearB) <= tol;

    let nonClearCount = 0;
    const colorSet = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      if (!isClearPx(i)) {
        nonClearCount++;
        colorSet.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
    }

    let transitions = 0;
    const midRow = Math.floor(height / 2);
    let prevClear = true;
    for (let x = 0; x < width; x++) {
      const i = (midRow * width + x) * 4;
      const clear = isClearPx(i);
      if (clear !== prevClear) transitions++;
      prevClear = clear;
    }

    return { width, height, nonClearCount, distinctColors: colorSet.size, transitions };
  }, [CLEAR_RGB[0], CLEAR_RGB[1], CLEAR_RGB[2], CLEAR_TOLERANCE] as const);
}

test("GPUTimeline paints real pixels through the Canvas2D fallback with WebGPU absent", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/playground/timeline");

  // Confirm the fallback actually engaged, not the GPU path. `navigator.gpu`'s getter is
  // overridden to return `undefined` (not `delete`d — `in` would still see the property), so
  // check the resolved value, not property presence.
  await expect.poll(async () => page.evaluate(() => navigator.gpu)).toBe(undefined);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeAttached();

  // Wait a couple of frames for the Canvas2DScheduler's rAF-fallback loop to paint.
  await page.waitForTimeout(500);

  const summary = await readCanvasPixels(page);
  expect(summary.nonClearCount, "expected some non-clear-colour pixels — something was painted").toBeGreaterThan(500);
  expect(summary.distinctColors, "expected at least 3 distinct span colours").toBeGreaterThanOrEqual(3);
  expect(summary.transitions, "expected multiple clear/non-clear transitions — individual spans, not a smear").toBeGreaterThan(4);

  // Switch into raster-LOD range: the "500k" spans control. Default stage width (~900px) puts
  // 500k spans' estimated density well past DEFAULT_LOD_THRESHOLD (4/px-column).
  await page.getByRole("button", { name: "500k" }).click();
  await page.waitForTimeout(800);

  const rasterSummary = await readCanvasPixels(page);
  expect(rasterSummary.nonClearCount, "expected the raster density field to paint something").toBeGreaterThan(500);
  // The raster ramp is a continuous gradient (hi/lo colormap), so many distinct colours are
  // expected here — the interesting assertion is that it's still visibly different from the
  // clear-only background, i.e. plenty of non-clear pixels, already asserted above.

  expect(consoleErrors.filter((e) => /VGPU-|Uncaught/.test(e)), `console errors: ${JSON.stringify(consoleErrors)}`).toEqual([]);
  expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
});

test("GPUTimeline's backend readout reports the Canvas2D fallback, not WebGPU", async ({ page }) => {
  await page.goto("/playground/timeline");
  await page.waitForTimeout(300);
  await expect(page.getByText("Canvas2D fallback (no WebGPU)")).toBeVisible();
});
