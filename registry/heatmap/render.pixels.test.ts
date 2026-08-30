import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu, type StorageBuffer } from "vgpu";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type Capabilities,
  type ComponentContext,
} from "@gpu-components/core";
import { computeRange, ingestMatrix } from "./ingest.ts";
import { HeatmapComponent } from "./HeatmapComponent.ts";

/**
 * `GPUHeatmap` render correctness through real Dawn (PLAN.md §23.3).
 *
 * Written *with* the component rather than after it, which is the whole lesson of the Timeline's
 * blank-canvas defect: mock tests prove the bindings are well-formed, and a component can be
 * perfectly well-formed and still draw nothing. It also does what §23.3 asks of a compute kernel —
 * "dispatch, `StorageBuffer.read()`, compare against a CPU reference" — by checking the GPU's
 * min/max reduction against `computeRange()`, the same oracle the fallback path would use.
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

const W = 64;
const H = 64;

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
 * A 4x4 matrix of 0..15 over a 64x64 surface, so every cell is a 16px block and each one's centre
 * is nameable: column c spans x = c*16..(c+1)*16, row r's centre is y = 8 + r*16.
 */
const DATA = ingestMatrix(Float32Array.from({ length: 16 }, (_, i) => i), 4, 4);
const VIEWPORT = { timeStart: 0, timeEnd: 4, trackCount: 4, width: W, height: H };

interface Rendered {
  readonly pixels: Uint8Array;
  readonly nonBlack: number;
  readonly component: HeatmapComponent;
}

async function render(gpu: Gpu): Promise<Rendered> {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const ctx = makeCtx(gpu, surfaceTarget);
  const component = new HeatmapComponent();
  component.create(ctx);
  component.update({ data: DATA, viewport: VIEWPORT });

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
  return { pixels, nonBlack, component };
}

function rgb(pixels: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 4;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}

const luminance = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("GPUHeatmap render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });

  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("fills the surface — a 4x4 matrix covers every pixel", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    const { nonBlack, component } = await render(gpu);
    assert.equal(nonBlack, W * H, "every pixel should be inside some cell");
    component.dispose();
  });

  it("computes min/max on the GPU, matching the CPU oracle exactly", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    const { component } = await render(gpu);

    // §23.3: dispatch, read the storage buffer, compare against a CPU reference.
    const buffer = (component as unknown as { rangeBuffer: StorageBuffer }).rangeBuffer;
    const raw = await buffer.read();
    const range = new Float32Array(raw.buffer ?? (raw as unknown as ArrayBuffer));

    assert.deepEqual([range[0], range[1]], [...computeRange(DATA)], "GPU reduction must match computeRange()");
    component.dispose();
  });

  it("maps low values to the dark end of the ramp and high values to the bright end", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    const { pixels, component } = await render(gpu);

    // Cell (row 0, col 0) = value 0 → ramp start; (row 3, col 3) = value 15 → ramp end.
    const lowest = rgb(pixels, 8, 8);
    const highest = rgb(pixels, 56, 56);

    assert.ok(
      luminance(highest) > luminance(lowest) + 100,
      `expected a wide luminance span, got ${luminance(lowest).toFixed(0)} -> ${luminance(highest).toFixed(0)}`,
    );
    // Viridis starts deep purple and ends bright yellow — assert the hue, not just the brightness,
    // so a broken LUT bind that produced greyscale would still fail.
    assert.ok(highest[0]! > 200 && highest[1]! > 180 && highest[2]! < 90, `expected yellow, got ${highest}`);
    assert.ok(lowest[2]! > lowest[1]!, `expected the dark end to be purple-ish, got ${lowest}`);
    component.dispose();
  });

  it("increases monotonically across the row, cell by cell", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable on this machine");
    const { pixels, component } = await render(gpu);

    // Row 0 holds values 0,1,2,3 left to right — luminance must climb with each 16px cell.
    const lums = [0, 1, 2, 3].map((col) => luminance(rgb(pixels, col * 16 + 8, 8)));
    for (let i = 1; i < lums.length; i++) {
      assert.ok(lums[i]! > lums[i - 1]!, `cell ${i} should be brighter than ${i - 1}: ${lums.join(", ")}`);
    }
    component.dispose();
  });
});
