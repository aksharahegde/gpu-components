import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { viewportUniforms, CANVAS2D_CAPS, createWarningsLog } from "@gpuc/core";
import type { ViewportUniforms } from "@gpuc/core";
import {
  createHighlightQuadPolicy,
  createSpanQuadPolicy,
  cpuDensityBin,
  cpuReduceDensity,
  TIMELINE_PALETTE_RGBA8,
} from "./fallback.ts";
import { ingestSpans, packInstances } from "./ingest.ts";
import { TIMELINE_WGSL } from "./timeline.wgsl.ts";
import { DENSITY_BIN_WGSL } from "./densityBin.wgsl.ts";
import { PIXEL_COLUMNS } from "./TimelineComponent.ts";

const VIEWPORT: ViewportUniforms = viewportUniforms({
  timeStart: 0,
  timeEnd: 100,
  trackCount: 2,
  width: 200,
  height: 100,
});

describe("createSpanQuadPolicy — decode() parity with timeline.wgsl.ts's vs_main", () => {
  it("matches the hand-computed clip-space rect for an in-view span", () => {
    // start=10, duration=30, track=0. timeToClip = [0.02, -1], trackToClip = [-1, 0.5].
    // xStart = 10*0.02 - 1 = -0.8; xEnd = 40*0.02 - 1 = -0.2.
    // rowCenter = 0*-1 + 0.5 = 0.5; halfRow = abs(-1)*0.5*0.7 = 0.35.
    // y0 = 0.5-0.35 = 0.15; y1 = 0.5+0.35 = 0.85.
    const spans = ingestSpans([{ start: 10, duration: 30, track: 0, colorIndex: 0 }]);
    const bytes = packInstances(spans, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const policy = createSpanQuadPolicy(() => false);

    const rect = policy.decode(view, 0, VIEWPORT);
    assert.ok(rect);
    assert.ok(Math.abs(rect!.x0 - -0.8) < 1e-6, `x0 = ${rect!.x0}`);
    assert.ok(Math.abs(rect!.x1 - -0.2) < 1e-6, `x1 = ${rect!.x1}`);
    assert.ok(Math.abs(rect!.y0 - 0.15) < 1e-6, `y0 = ${rect!.y0}`);
    assert.ok(Math.abs(rect!.y1 - 0.85) < 1e-6, `y1 = ${rect!.y1}`);
    assert.equal(rect!.color, TIMELINE_PALETTE_RGBA8[0]);
  });

  it("matches the hand-computed clip-space rect for a second track/colour", () => {
    // start=50, duration=20, track=1, colorIndex=2. trackToClip = [-1, 0.5].
    // xStart = 50*0.02-1 = 0; xEnd = 70*0.02-1 = 0.4.
    // rowCenter = 1*-1+0.5 = -0.5; halfRow = 0.35 -> y0=-0.85, y1=-0.15.
    const spans = ingestSpans([{ start: 50, duration: 20, track: 1, colorIndex: 2 }]);
    const bytes = packInstances(spans, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const policy = createSpanQuadPolicy(() => false);

    const rect = policy.decode(view, 0, VIEWPORT);
    assert.ok(rect);
    assert.ok(Math.abs(rect!.x0 - 0) < 1e-6, `x0 = ${rect!.x0}`);
    assert.ok(Math.abs(rect!.x1 - 0.4) < 1e-6, `x1 = ${rect!.x1}`);
    assert.ok(Math.abs(rect!.y0 - -0.85) < 1e-6, `y0 = ${rect!.y0}`);
    assert.ok(Math.abs(rect!.y1 - -0.15) < 1e-6, `y1 = ${rect!.y1}`);
    assert.equal(rect!.color, TIMELINE_PALETTE_RGBA8[2]);
  });

  it("clamps a sub-pixel-duration span to exactly pxSize.x * 1.5 wide", () => {
    const spans = ingestSpans([{ start: 10, duration: 0.0001, track: 0, colorIndex: 0 }]);
    const bytes = packInstances(spans, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const policy = createSpanQuadPolicy(() => false);

    const rect = policy.decode(view, 0, VIEWPORT)!;
    const minWidth = VIEWPORT.pxSize[0] * 1.5;
    assert.ok(Math.abs(rect.x1 - rect.x0 - minWidth) < 1e-9, `width = ${rect.x1 - rect.x0}, expected ${minWidth}`);
  });

  it("culls a span entirely left of the viewport to null", () => {
    const spans = ingestSpans([{ start: -50, duration: 10, track: 0, colorIndex: 0 }]);
    const bytes = packInstances(spans, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const policy = createSpanQuadPolicy(() => false);
    assert.equal(policy.decode(view, 0, VIEWPORT), null);
  });

  it("culls a span entirely right of the viewport to null", () => {
    const spans = ingestSpans([{ start: 500, duration: 10, track: 0, colorIndex: 0 }]);
    const bytes = packInstances(spans, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const policy = createSpanQuadPolicy(() => false);
    assert.equal(policy.decode(view, 0, VIEWPORT), null);
  });

  it("tints a selected span toward ink, matching mix(color, ink, 0.4)", () => {
    const spans = ingestSpans([{ start: 10, duration: 30, track: 0, colorIndex: 0 }]);
    const bytes = packInstances(spans, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const policy = createSpanQuadPolicy(() => true);

    const rect = policy.decode(view, 0, VIEWPORT)!;
    const base = TIMELINE_PALETTE_RGBA8[0]!;
    const r = (base >>> 24) & 255;
    const g = (base >>> 16) & 255;
    const b = (base >>> 8) & 255;
    const expected =
      ((Math.round(r * 0.6 + 13 * 0.4) << 24) |
        (Math.round(g * 0.6 + 15 * 0.4) << 16) |
        (Math.round(b * 0.6 + 20 * 0.4) << 8) |
        255) >>>
      0;
    assert.equal(rect.color, expected);
  });
});

describe("TIMELINE_PALETTE_RGBA8 — round-trips against timeline.wgsl.ts's literals", () => {
  it("matches every PALETTE entry parsed straight out of the shader source", () => {
    const match = TIMELINE_WGSL.match(/const PALETTE = array<vec4f, 6>\(([\s\S]*?)\);/);
    assert.ok(match, "expected to find the PALETTE array in TIMELINE_WGSL");
    const literalPattern = /vec4f\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/g;
    const parsed: number[][] = [];
    let m: RegExpExecArray | null;
    while ((m = literalPattern.exec(match![1]!))) {
      parsed.push([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
    }
    assert.equal(parsed.length, 6, "expected 6 palette entries");

    parsed.forEach(([r, g, b, a], i) => {
      const expected =
        ((Math.round(r! * 255) << 24) | (Math.round(g! * 255) << 16) | (Math.round(b! * 255) << 8) | Math.round(a! * 255)) >>>
        0;
      assert.equal(TIMELINE_PALETTE_RGBA8[i], expected, `palette entry ${i}`);
    });
  });
});

describe("createHighlightQuadPolicy", () => {
  it("uses the amber wash for kind 1 (selected) and the ink wash otherwise (hover)", () => {
    const spans = ingestSpans([
      { start: 10, duration: 30, track: 0, colorIndex: 0 }, // hover (kind 0)
      { start: 10, duration: 30, track: 0, colorIndex: 1 }, // selected (kind 1)
    ]);
    const bytes = packInstances(spans, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const policy = createHighlightQuadPolicy();

    const hover = policy.decode(view, 0, VIEWPORT)!;
    const selected = policy.decode(view, 1, VIEWPORT)!;
    assert.notEqual(hover.color, selected.color);
    // Selected: amber, high red/green, low-ish blue, alpha ~0x73.
    assert.equal(selected.color & 0xff, 0x73);
    // Hover: ink, low RGB, alpha ~0x29.
    assert.equal(hover.color & 0xff, 0x29);
  });
});

describe("cpuDensityBin — CPU/GPU parity with densityBin.wgsl.ts", () => {
  async function initDawn() {
    try {
      const { init } = await import("vgpu/node");
      return await init();
    } catch {
      return null;
    }
  }

  it("matches the real WGSL compute shader's output exactly for the same span fixture", async () => {
    const gpu = await initDawn();
    if (!gpu) {
      // Dawn isn't available on this machine — skip cleanly, per this repo's own convention
      // (render.pixels.test.ts's `initDawn` does the same).
      return;
    }
    try {
      const { compute, storage, uniforms } = await import("vgpu");
      const spans = ingestSpans(
        Array.from({ length: 500 }, (_, i) => ({
          start: (i * 37) % 100,
          duration: 1 + (i % 5),
          track: i % 2,
          colorIndex: i % 6,
        })),
      );
      const bytes = packInstances(spans, 0);
      const trackCount = 2;

      const instancesBuf = storage(gpu, bytes.byteLength, "read");
      instancesBuf.write(bytes);
      const params = uniforms(gpu, { timeStart: 0, timeEnd: 100, count: spans.count });
      const densityParams = uniforms(gpu, { pixelColumns: PIXEL_COLUMNS, trackCount });
      const densityBuf = storage(gpu, trackCount * PIXEL_COLUMNS * 4, "read-write");
      densityBuf.write(new Uint32Array(trackCount * PIXEL_COLUMNS));

      const pipeline = compute(gpu, DENSITY_BIN_WGSL);
      pipeline.set({ params, instances: instancesBuf, density_params: densityParams, density: densityBuf });
      pipeline.dispatch(Math.ceil(spans.count / 64));
      await gpu.settled();

      const gpuResult = new Uint32Array(await densityBuf.read());

      const cpuResult = new Uint32Array(trackCount * PIXEL_COLUMNS);
      cpuDensityBin(spans, 0, 100, trackCount, PIXEL_COLUMNS, cpuResult);

      assert.deepEqual(Array.from(cpuResult), Array.from(gpuResult));
    } finally {
      gpu.dispose();
    }
  });
});

describe("cpuReduceDensity", () => {
  it("matches a hand-computed per-track max", () => {
    const density = new Uint32Array(2 * PIXEL_COLUMNS);
    density[5] = 3;
    density[10] = 7;
    density[PIXEL_COLUMNS + 2] = 4;
    const maxPerTrack = new Uint32Array(2);
    cpuReduceDensity(density, maxPerTrack, 2, PIXEL_COLUMNS);
    assert.deepEqual(Array.from(maxPerTrack), [7, 4]);
  });
});

describe("cpuDensityBin — strided sampling above the Canvas2D cap", () => {
  it("preserves total mass within the stride factor and reports a warning", () => {
    const count = CANVAS2D_CAPS.binnedSpans + 1000;
    const spans = ingestSpans(
      Array.from({ length: count }, (_, i) => ({ start: i % 100, duration: 1, track: 0, colorIndex: 0 })),
    );
    const density = new Uint32Array(1 * PIXEL_COLUMNS);
    const warnings = createWarningsLog();

    const { stride } = cpuDensityBin(spans, 0, 100, 1, PIXEL_COLUMNS, density, warnings, "test");
    assert.ok(stride > 1, "expected sampling to engage above the cap");

    const totalMass = density.reduce((a, b) => a + b, 0);
    // Every span contributes stride to its bucket when sampled, so total mass should land near
    // `count` (within one stride's worth of rounding at the sampled boundary).
    assert.ok(Math.abs(totalMass - count) <= stride, `total mass ${totalMass} vs span count ${count}`);

    const found = warnings.recent.find((w) => w.code === "canvas2d-degraded");
    assert.ok(found, "expected a canvas2d-degraded warning above the binning cap");
  });
});
