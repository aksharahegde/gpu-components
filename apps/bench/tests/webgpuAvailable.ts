import type { Page } from "@playwright/test";

/**
 * Whether the WebGPU scenarios should run at all on this machine.
 *
 * Two mechanisms, because the obvious one is not sufficient on its own.
 *
 * `BENCH_SKIP_WEBGPU` is the authoritative answer when it is set, and `bench.yml` sets it. On a
 * GPU-less runner, *asking* about WebGPU is itself unsafe: the first attempt to reach an adapter
 * takes the GPU process down, and Playwright reports that as "Resulting promise was garbage
 * collected" from whatever `page.evaluate` was in flight — including a `page.evaluate` whose only
 * job was to find out whether WebGPU works. A probe cannot be the whole answer to a question that
 * crashes when asked, so an environment that knows it has no GPU says so up front and no WebGPU
 * call is ever made.
 *
 * It is an explicit opt-out rather than a `process.env.CI` check so that giving the job a real GPU
 * later is a matter of not setting the variable, rather than of finding and deleting a hidden
 * assumption that CI means no hardware.
 *
 * The runtime probe still exists for every machine that does not set the variable — a developer
 * laptop, a self-hosted runner — and it now treats a rejected `page.evaluate` as "unavailable"
 * too. The first version of this helper caught errors *inside* the page and not the rejection
 * raised when the page dies underneath it, so it re-threw exactly the crash it was written to
 * absorb.
 */
export async function webgpuAvailable(page: Page): Promise<boolean> {
  if (process.env.BENCH_SKIP_WEBGPU) return false;

  try {
    return await page.evaluate(async () => {
      const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (!gpu) return false;
      try {
        // Raced against a timeout rather than awaited. A missing backend is meant to resolve null,
        // but a half-initialised one can leave the promise pending forever, and a probe that hangs
        // turns a fast skip into a spec timeout — the same red build, just slower.
        const adapter = await Promise.race([
          gpu.requestAdapter(),
          new Promise((resolve) => setTimeout(() => resolve(null), 5_000)),
        ]);
        return adapter != null;
      } catch {
        return false;
      }
    });
  } catch {
    // The page crashed, or the evaluate was torn down with it. Either way there is no usable
    // adapter here.
    return false;
  }
}

/** Printed by every skipping spec, so a green run still says what it did not measure. */
export const NO_WEBGPU_REASON =
  "no WebGPU adapter on this machine — WebGPU scenarios need a real GPU (see BENCH_SKIP_WEBGPU)";
