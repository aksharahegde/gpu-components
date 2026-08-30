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
        launchOptions: { args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--use-gl=angle"] },
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
