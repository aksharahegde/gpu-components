#!/usr/bin/env node
// PLAN.md §20.1 environment (a): "headless Node + Dawn via vgpu/node for determinism and CI
// trend-tracking." WebGPU-only — the DOM/Canvas2D/WebGL2 comparison numbers live in
// `results/BASELINES.md`, produced by the real-browser Playwright harness (environment (c)). This
// script exists purely to catch WebGPU-path perf regressions on every push without needing a
// browser in CI.
//
// Run: node ci/trend.mjs   (or `npm run trend` from apps/bench)
//
// Known rough edge: real Dawn (unlike `vgpu/mock`'s software backend) logs a validation warning —
// "Destroyed texture ... used in a submit" — because `@gpuc/testing`'s
// `createMockCanvasContext` recreates the canvas texture on every `getCurrentTexture()` call rather
// than caching it for the frame, which real `GPUCanvasContext` presentation semantics expect. The
// script still runs and produces real numbers, but this should be fixed in
// `packages/testing/src/mockCanvas.ts` before fully trusting `trend.mjs`'s output — it's a shared
// test-infra file other passing tests (`GPUProvider.test.ts`) also depend on, so it wasn't touched
// here rather than risk destabilizing those.

import { init as nodeInit } from "vgpu/node";
import { createMockCanvas, tick } from "@gpuc/testing";
import { GpuRuntime } from "@gpuc/core";
import { ingestSpans } from "../../../registry/timeline/ingest.ts";
import { TimelineComponent } from "../../../registry/timeline/TimelineComponent.ts";
import { generateDataset } from "../src/generators.ts";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TREND_FILE = path.resolve(__dirname, "../results/trend.jsonl");

// A conservative, hand-built `Capabilities` — `probeCapabilities()` needs `navigator.gpu`, which
// does not exist under Node. Mirrors `@gpuc/testing`'s `capabilitiesFor` pattern.
const CAPS = {
  webgpu: true,
  timestampQuery: false,
  float32Filterable: false,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  tier: "gpu",
};

const SIZE = 100_000;
const FRAMES = 120;

function toRawSpans(dataset) {
  const spans = new Array(dataset.size);
  for (let i = 0; i < dataset.size; i++) {
    spans[i] = {
      start: dataset.start[i],
      duration: dataset.duration[i],
      track: dataset.track[i],
      colorIndex: dataset.colorIndex[i],
    };
  }
  return spans;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Dawn needs a real adapter, and a runner without a GPU does not have one — `nodeInit()` throws
 * `VGPU-NODE-NO-ADAPTER` there. That is not a regression to fail the build over, it is an absent
 * measurement, so this exits cleanly and says so.
 *
 * vgpu's own error suggests `npx vgpu install-software-renderer`, and that is deliberately not
 * taken. This script's whole purpose is catching WebGPU-path *perf* regressions, and it appends to
 * `trend.jsonl`. Feeding CPU-rendered timings into a GPU trend line would not merely be noise, it
 * would be indistinguishable from hardware data after the fact — a worse outcome than a gap. The
 * same reasoning keeps SwiftShader out of the Playwright matrix.
 */
async function initOrSkip() {
  if (process.env.BENCH_SKIP_WEBGPU) {
    console.log("trend: skipped — BENCH_SKIP_WEBGPU is set, so this machine has no GPU to trend.");
    return null;
  }
  try {
    return await nodeInit();
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : null;
    if (code === "VGPU-NODE-NO-ADAPTER") {
      console.log("trend: skipped — no WebGPU adapter (Dawn found no GPU on this machine).");
      console.log("trend: nothing written to trend.jsonl; a GPU runner is what restores this data.");
      return null;
    }
    throw err;
  }
}

async function main() {
  const gpu = await initOrSkip();
  if (!gpu) return;
  const canvas = createMockCanvas(gpu, [800, 300]);
  const runtime = GpuRuntime.createWithGpu(gpu, CAPS);

  const dataset = generateDataset("bursty", SIZE);
  const spans = ingestSpans(toRawSpans(dataset));

  let component = null;
  const handle = runtime.mount((_ctx) => {
    component = new TimelineComponent(SIZE);
    return component;
  }, canvas);

  const viewport = { timeStart: 0, timeEnd: 1, trackCount: dataset.trackCount, width: 800, height: 300 };
  component.update({ spans, viewport });

  // No `requestAnimationFrame` under Node — `FrameScheduler`'s `frameLoop` self-drives via a 16ms
  // `setTimeout` fallback (see `@gpuc/testing`'s `tick()`, which this reuses: "a real, if
  // coarse, clock — not a fake timer"). `invalidate()` marks the surface dirty so the *next*
  // autonomous tick actually redraws; wall-clock between successive `tick()` calls is the frame
  // timing proxy, coarser than a browser rAF loop but genuine wall-clock, not a stub.
  const samples = [];
  let last = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    runtime.invalidate();
    await tick();
    const now = performance.now();
    samples.push(now - last);
    last = now;
  }

  handle.unmount();
  runtime.dispose();

  const sorted = [...samples].sort((a, b) => a - b);
  const result = {
    timestamp: new Date().toISOString(),
    size: SIZE,
    frames: FRAMES,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    worst: sorted[sorted.length - 1] ?? 0,
  };

  mkdirSync(path.dirname(TREND_FILE), { recursive: true });
  appendFileSync(TREND_FILE, JSON.stringify(result) + "\n");
  console.log(`vgpu/node trend: p50=${result.p50.toFixed(2)}ms p95=${result.p95.toFixed(2)}ms (n=${SIZE.toLocaleString("en-US")} spans)`);
}

main().catch((err) => {
  console.error("bench trend: failed —", err);
  process.exitCode = 1;
});
