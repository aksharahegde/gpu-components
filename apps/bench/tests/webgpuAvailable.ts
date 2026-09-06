import type { Page } from "@playwright/test";

/**
 * Whether this browser can actually get a WebGPU adapter.
 *
 * `navigator.gpu` existing is not the same as WebGPU working: in headless Chromium the object is
 * present and `requestAdapter()` still resolves to `null` when there is no usable backend, which is
 * the normal state on a CI runner with no GPU. The scenarios that only measure WebGPU have nothing
 * to say on such a machine, and should skip rather than fail — the alternative is either a red
 * build on every PR or, worse, publishing software-rendered timings as if they were hardware.
 *
 * Deliberately *not* solved by forcing SwiftShader in CI. That would make the suite green and the
 * numbers meaningless, and `PRODUCT.md` is explicit that this project does not print a performance
 * figure the harness has not honestly produced. Restoring WebGPU coverage in CI means giving the
 * job a real GPU, not a software rasteriser.
 */
export async function webgpuAvailable(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    try {
      // Raced against a timeout rather than simply awaited. A missing backend is *supposed* to
      // resolve `null`, but a half-initialised one can leave the promise pending forever, and a
      // probe that hangs would turn a fast skip into a spec timeout — the same red build this
      // helper exists to prevent, just slower.
      const adapter = await Promise.race([
        gpu.requestAdapter(),
        new Promise((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
      return adapter != null;
    } catch {
      return false;
    }
  });
}

/** Printed by every skipping spec, so a green CI run still says what it did not measure. */
export const NO_WEBGPU_REASON =
  "no WebGPU adapter in this browser — WebGPU scenarios need a machine with a GPU";
