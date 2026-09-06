import { defineConfig, devices } from "@playwright/test";

const PORT = 5175;

export default defineConfig({
  testDir: "./tests",
  timeout: 15 * 60 * 1000, // large-N cells (5M/10M spans) can legitimately take minutes
  fullyParallel: false, // one browser session drives every cell sequentially — see tests/bench.spec.ts
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Headless Chromium needs an explicit GPU backend for WebGPU — without this, `navigator.gpu`
        // resolves but `requestAdapter()` fails silently in headless mode.
        //
        // The backend is platform-specific and picking the wrong one is worse than picking none:
        // `--use-angle=metal` was hard-coded here (written on a Mac, and this config's own comment
        // below admits only this environment was ever verified). On Linux CI that flag does not
        // fail over to something workable — it takes the GPU process down, and Playwright surfaces
        // that as "Resulting promise was garbage collected" from whatever `page.evaluate` was in
        // flight. Every WebGPU cell in the matrix crashed that way on the first real CI run while
        // DOM, Canvas2D and WebGL2 all reported numbers.
        //
        // Elsewhere, let Chromium choose its own backend. On a machine with a GPU that resolves to
        // a real adapter; on a GPU-less runner `requestAdapter()` returns null and the WebGPU
        // scenarios skip themselves (see `tests/webgpuAvailable.ts`) rather than crashing.
        launchOptions: {
          args: [
            "--enable-unsafe-webgpu",
            ...(process.platform === "darwin" ? ["--use-angle=metal", "--use-gl=angle"] : []),
          ],
        },
      },
    },
    // Firefox/WebKit: PLAN.md §20.1 wants all three, but this dev environment only has Chromium
    // installed/verified (`npx playwright install chromium`). Uncomment and
    // `npx playwright install firefox webkit` once verified on a machine that has them —
    // WebGPU support/flags differ per browser and need checking, not just enabling.
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
