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
  type ViewportState,
} from "@gpu-components/core";
import { generateImage, ingestPair, type DiffMode } from "./ingest.ts";
import { ImageDiffComponent } from "./ImageDiffComponent.ts";

/**
 * Real-Dawn verification for the project's first texture-sampling component.
 *
 * These assertions target what only a texture path can get wrong: that the image is sampled at all,
 * that it lands the right way up (a flipped V coordinate is the classic texture bug and looks
 * plausible until you compare against the source), that each comparison mode composites what it
 * claims, and that the changed-pixel count computed on the GPU matches a CPU count of the same
 * images.
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

const W = 128;
const H = 128;
/** Image size, chosen so one image pixel is exactly one surface pixel at the default viewport. */
const IMG = 64;

/** Left half red, right half green — asymmetric on x so a mirrored U is visible. */
const BEFORE = generateImage(IMG, IMG, (x) => (x < IMG / 2 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
/**
 * Same, except the top-left quadrant is blue. Asymmetric on y too, so a flipped V is visible, and
 * the changed region is exactly a quarter of the image — a count a test can assert exactly.
 */
const AFTER = generateImage(IMG, IMG, (x, y) =>
  x < IMG / 2 && y < IMG / 2 ? [0, 0, 255, 255] : x < IMG / 2 ? [255, 0, 0, 255] : [0, 255, 0, 255],
);
const PAIR = ingestPair(BEFORE, AFTER);

const VIEWPORT: ViewportState = {
  timeStart: 0,
  timeEnd: IMG,
  trackCount: IMG,
  rowStart: 0,
  rowEnd: IMG,
  yContinuous: true,
  width: W,
  height: H,
};

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
    surface: { surface: surfaceTarget, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps: CAPS,
    onDispose: () => {},
  };
}

async function render(gpu: Gpu, mode: DiffMode, extra: Record<string, unknown> = {}) {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new ImageDiffComponent();
  component.create(makeCtx(gpu, surfaceTarget));
  component.update({ pair: PAIR, viewport: VIEWPORT, mode, ...extra });

  const plan = component.plan();
  for (const pass of plan.computePasses) pass.dispatch();
  frame(gpu, (f) => {
    f.pass({ target: surfaceTarget, clear: true }, (fp) => {
      for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
    });
  });
  await gpu.settled();
  return { pixels: (await surfaceTarget.read()) as Uint8Array, component };
}

function rgb(pixels: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 4;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}
/** Which primary dominates — robust to a channel being off by a few. */
function dominant(c: readonly [number, number, number]): "r" | "g" | "b" | "none" {
  const [r, g, b] = c;
  if (r > g + 40 && r > b + 40) return "r";
  if (g > r + 40 && g > b + 40) return "g";
  if (b > r + 40 && b > g + 40) return "b";
  return "none";
}

describe("GPUImageDiff render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("samples the texture the right way up and the right way round", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Onion at blend 1 shows the AFTER image alone: blue top-left, red bottom-left, green right.
    const { pixels, component } = await render(gpu, "onion", { blend: 1 });

    assert.equal(dominant(rgb(pixels, 32, 32)), "b", "top-left quadrant should be blue");
    assert.equal(dominant(rgb(pixels, 32, 96)), "r", "bottom-left should be red — a flipped V would swap these");
    assert.equal(dominant(rgb(pixels, 96, 32)), "g", "right half should be green — a mirrored U would swap these");

    component.dispose();
  });

  it("shows the before image at blend 0, proving both textures are bound", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { pixels, component } = await render(gpu, "onion", { blend: 0 });
    assert.equal(dominant(rgb(pixels, 32, 32)), "r", "before has no blue quadrant");
    component.dispose();
  });

  it("splits at the divider, before on the left and after on the right", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Divider at 0.25: left quarter is BEFORE (red at the top), the rest is AFTER.
    const { pixels, component } = await render(gpu, "split", { split: 0.25 });
    assert.equal(dominant(rgb(pixels, 10, 20)), "r", "left of the divider shows the before image");
    assert.equal(dominant(rgb(pixels, 50, 20)), "b", "right of it shows the after image's blue quadrant");
    component.dispose();
  });

  it("shows only the changed region in difference mode", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { pixels, component } = await render(gpu, "difference");

    // The changed quadrant is red->blue, so both channels differ and the pixel is bright.
    const changed = rgb(pixels, 32, 32);
    assert.ok(changed[0]! + changed[1]! + changed[2]! > 200, `changed region should be bright, got ${changed}`);
    // Everywhere else is identical between the images: black.
    const unchanged = rgb(pixels, 96, 96);
    assert.deepEqual(unchanged, [0, 0, 0], "identical pixels must be black in difference mode");

    component.dispose();
  });

  it("counts changed pixels on the GPU, matching a CPU count exactly", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const { component } = await render(gpu, "difference");
    const stats = await component.readStats();
    assert.ok(stats);

    // CPU oracle over the same two images, using the same threshold.
    let expected = 0;
    for (let i = 0; i < BEFORE.data.length; i += 4) {
      const dr = Math.abs(AFTER.data[i]! - BEFORE.data[i]!) / 255;
      const dg = Math.abs(AFTER.data[i + 1]! - BEFORE.data[i + 1]!) / 255;
      const db = Math.abs(AFTER.data[i + 2]! - BEFORE.data[i + 2]!) / 255;
      if (Math.max(dr, dg, db) > 0.02) expected++;
    }

    assert.equal(stats!.changedPixels, expected);
    assert.equal(stats!.changedPixels, (IMG * IMG) / 4, "exactly the one changed quadrant");
    assert.equal(stats!.totalPixels, IMG * IMG);
    assert.ok(stats!.maxDelta > 0.9, `red->blue is a near-full-scale change, got ${stats!.maxDelta}`);

    component.dispose();
  });

  it("reports zero changes for identical images", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const surfaceTarget = target(gpu, { size: [W, H] });
    const component = new ImageDiffComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({ pair: ingestPair(BEFORE, BEFORE), viewport: VIEWPORT, mode: "difference" });
    for (const pass of component.plan().computePasses) pass.dispatch();
    await gpu.settled();

    const stats = await component.readStats();
    assert.equal(stats?.changedPixels, 0, "a diff against itself must be empty");
    component.dispose();
  });
});
