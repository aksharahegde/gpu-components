import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type Capabilities,
  type ComponentContext,
} from "@gpuc/core";
import { TimelineComponent } from "./TimelineComponent.ts";
import { ingestSpans } from "./ingest.ts";

/**
 * PLAN.md §23.3 — GPU render correctness through `vgpu/node` (real Dawn), reading actual pixels
 * back with `target.read()`.
 *
 * **This file exists because of a specific defect that three other layers of verification missed.**
 * `trackedUniforms()` used to return a bare `{ set }` stand-in, which satisfies the
 * `SharedUniforms` type but is not the GPU-backed resource `draw.set()` needs to bind. The shader
 * therefore read an all-zero viewport, every span quad collapsed to zero height, and `GPUTimeline`
 * rendered a perfectly clean empty frame. No error, no warning. The `vgpu/mock` tests passed
 * (binding *wiring* was valid), the benchmark harness ran it thousands of times per run (it times
 * frames, it does not look at them), and the site's only visual surface had its WebGPU row disabled.
 *
 * The lesson encoded here: at least one test must assert that pixels *exist*. Everything else can
 * be green while the component draws nothing.
 */

const CAPS: Capabilities = {
  ...NO_WEBGPU_CAPABILITIES,
  webgpu: true,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  tier: "gpu",
};

const W = 200;
const H = 100;

/** Dawn is a native dependency; a machine without it should skip these, not fail them. */
async function initDawn(): Promise<Gpu | null> {
  try {
    const { init } = await import("vgpu/node");
    return await init();
  } catch {
    return null;
  }
}

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>): ComponentContext {
  return {
    runtime: { caps: CAPS, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: {
      surface: surfaceTarget,
      get dirty() {
        return true;
      },
      clearDirty: () => {},
      markDirty: () => {},
    },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps: CAPS,
    onDispose: () => {},
  };
}

/**
 * Three deliberately fat spans on a [0, 100] domain over two tracks. Their pixel footprints are
 * hand-computed from the same transform `viewportUniforms()` applies, so the assertions below name
 * exact coordinates rather than "some pixels somewhere":
 *
 *   viewport → timeToClip [0.02, -1], trackToClip [-1, 0.5]
 *   span a   → x 20..80  px, track 0 → y 7.5..42.5 px
 *   span b   → x 100..160 px, track 0 → y 7.5..42.5 px
 *   span c   → x 80..160 px, track 1 → y 57.5..92.5 px
 */
const SPANS = ingestSpans([
  { start: 10, duration: 30, track: 0, label: "a" },
  { start: 50, duration: 30, track: 0, label: "b" },
  { start: 20, duration: 60, track: 1, label: "c" },
]);
const VIEWPORT = { timeStart: 0, timeEnd: 100, trackCount: 2, width: W, height: H };

interface Rendered {
  readonly pixels: Uint8Array;
  readonly nonBlack: number;
}

async function render(gpu: Gpu, lodThreshold?: number): Promise<Rendered> {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const ctx = makeCtx(gpu, surfaceTarget);
  const component = new TimelineComponent(64, lodThreshold);
  component.create(ctx);
  component.update({ spans: SPANS, viewport: VIEWPORT });

  const plan = component.plan();
  for (const pass of plan.computePasses) pass.dispatch();
  frame(gpu, (f) => {
    f.pass({ target: surfaceTarget, clear: true }, (framePass) => {
      for (const pass of plan.renderPasses) pass.encode(gpuPass(framePass));
    });
  });
  await gpu.settled();

  const pixels = (await surfaceTarget.read()) as Uint8Array;
  let nonBlack = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) nonBlack++;
  }
  component.dispose();
  return { pixels, nonBlack };
}

/** The RGB triple at (x, y). */
function rgb(pixels: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 4;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}

/** True if the pixel at (x, y) has any colour in it. */
function lit(pixels: Uint8Array, x: number, y: number): boolean {
  const i = (y * W + x) * 4;
  return pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0;
}

describe("GPUTimeline render correctness (real Dawn pixels)", () => {
  // One device for the whole suite, disposed in `after` — a leaked `Gpu` keeps Dawn's threads alive
  // and the test process never exits.
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });

  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("draws actual pixels — the regression guard for the all-zero viewport uniform", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    const { nonBlack } = await render(gpu);
    // The three spans alone cover well over a thousand pixels. Before the `trackedUniforms` fix
    // this was exactly 0, and every other test in the repo still passed.
    assert.ok(nonBlack > 1000, `expected a drawn timeline, got ${nonBlack} non-black pixels`);
  });

  it("puts each span where the viewport transform says it should be", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    const { pixels } = await render(gpu);

    assert.ok(lit(pixels, 50, 25), "span a should cover (50, 25)");
    assert.ok(lit(pixels, 130, 25), "span b should cover (130, 25)");
    assert.ok(lit(pixels, 120, 75), "span c should cover (120, 75)");

    // Its left edge is at exactly x=20 (t=10 → clip -0.8 → 20px), so x=19 is outside the span and
    // x=20 is the first painted column. This pins the transform to the pixel, not just to a region.
    assert.ok(!lit(pixels, 19, 25) || rgb(pixels, 19, 25).join() !== rgb(pixels, 20, 25).join());

    // …and it is drawn in the categorical palette's first colour (#8b9dff), which is what proves the
    // per-instance attributes made it into the shader rather than just the geometry.
    assert.deepEqual(rgb(pixels, 50, 25), [61, 79, 214], "span a should be palette colour 0");
  });

  it("leaves genuinely empty regions empty", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    const { pixels } = await render(gpu);

    // Track 0 has a gap between span a (…80px) and span b (100px…). x=90 avoids the 20px axis-rule
    // grid, and y=25 is clear of the track separator at y=50.
    assert.ok(!lit(pixels, 90, 25), "the gap between spans a and b should not be painted");
  });

  it("draws axis rules — the LineLayer primitive, end to end on real hardware", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    const { pixels } = await render(gpu);

    // The separator between rows 0 and 1 sits at clip y = 0, i.e. exactly the y=50 pixel *boundary*.
    // A 1px rule centred there covers 49.5–50.5, and the rasteriser lights the row above, so y=49 is
    // the correct expectation — not y=50. (Hairlines on exact boundaries are a real crispness
    // question; this asserts where it actually lands rather than papering over it with a tolerance.)
    assert.ok(lit(pixels, 90, 49), "the track separator should be drawn at y=49");
  });

  it("also draws in raster LOD mode", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    // lodThreshold 0 forces the density-field path for any non-empty dataset.
    const { nonBlack } = await render(gpu, 0);
    assert.ok(nonBlack > 500, `raster LOD mode drew ${nonBlack} non-black pixels`);
  });
});
