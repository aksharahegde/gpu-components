import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * PLAN.md §22, stage 5.4 — real-browser verification of the Canvas2D fallback. Adapted from
 * `apps/bench/playwright.config.ts`'s Chromium project, WITHOUT its WebGPU-enabling launch flags
 * (`--enable-unsafe-webgpu`, `--use-angle=metal`): this spec needs WebGPU absent, not present —
 * `navigator.gpu` is deleted per-page via `addInitScript` in the spec itself, but a Chromium build
 * that never exposes `navigator.gpu` in the first place (the default, unflagged case) is the
 * simpler and more representative target for "what happens in a browser with no WebGPU support".
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60 * 1000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: `npx next dev --webpack --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
