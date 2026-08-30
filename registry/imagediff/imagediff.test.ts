import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import { createMockGpu } from "@gpu-components/testing";
import {
  createImageTexture,
  createWarningsLog,
  GpuBudgetExceededError,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type ComponentContext,
} from "@gpu-components/core";
import { DIFF_MODES, generateImage, ingestPair, modeIndex } from "./ingest.ts";
import { ImageDiffComponent } from "./ImageDiffComponent.ts";

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>, caps = NO_WEBGPU_CAPABILITIES): ComponentContext {
  return {
    runtime: { caps, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: { surface: surfaceTarget, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps,
    onDispose: () => {},
  };
}

const VIEWPORT = {
  timeStart: 0, timeEnd: 8, trackCount: 8, rowStart: 0, rowEnd: 8,
  yContinuous: true, width: 16, height: 16,
};

describe("image ingest", () => {
  it("generates tightly packed RGBA", () => {
    const img = generateImage(2, 3, (x, y) => [x, y, 1, 255]);
    assert.equal(img.data.length, 2 * 3 * 4);
    assert.equal(img.width, 2);
    // Row-major: pixel (1,2) sits at offset (2*2 + 1) * 4.
    assert.equal(img.data[(2 * 2 + 1) * 4], 1);
    assert.equal(img.data[(2 * 2 + 1) * 4 + 1], 2);
  });

  it("rejects mismatched image sizes rather than scaling one", () => {
    const a = generateImage(4, 4, () => [0, 0, 0, 255]);
    const b = generateImage(4, 5, () => [0, 0, 0, 255]);
    assert.throws(() => ingestPair(a, b), /images must match/);
  });

  it("maps every mode to a stable index the shader agrees with", () => {
    assert.deepEqual([...DIFF_MODES], ["split", "onion", "difference", "heat"]);
    assert.equal(modeIndex("split"), 0);
    assert.equal(modeIndex("heat"), 3);
  });
});

describe("createImageTexture", () => {
  it("uploads pixel data and reports its dimensions", async () => {
    const { gpu, caps } = await createMockGpu();
    const image = generateImage(4, 4, () => [10, 20, 30, 255]);
    const texture = createImageTexture(gpu, image, caps, { label: "test" });
    assert.equal(texture.width, 4);
    assert.equal(texture.height, 4);
    assert.ok(texture.view);
    texture.destroy();
    gpu.dispose();
  });

  it("rejects a byte count that does not match the dimensions", async () => {
    const { gpu, caps } = await createMockGpu();
    const broken = { data: new Uint8Array(new ArrayBuffer(10)), width: 4, height: 4 };
    assert.throws(() => createImageTexture(gpu, broken, caps), /expected 64 bytes/);
    gpu.dispose();
  });

  it("rejects non-positive dimensions", async () => {
    const { gpu, caps } = await createMockGpu();
    const empty = { data: new Uint8Array(new ArrayBuffer(0)), width: 0, height: 4 };
    assert.throws(() => createImageTexture(gpu, empty, caps), /positive integers/);
    gpu.dispose();
  });

  it("throws a typed budget error above maxTextureDimension2D", async () => {
    // The limit that had been probed since Phase 1 and read by nothing until this component.
    const { gpu } = await createMockGpu();
    const image = generateImage(4, 4, () => [0, 0, 0, 255]);
    assert.throws(
      () => createImageTexture(gpu, image, { maxTextureDimension2D: 2 }, { label: "big" }),
      GpuBudgetExceededError,
    );
    gpu.dispose();
  });

  it("treats an unprobed limit as no limit", async () => {
    const { gpu } = await createMockGpu();
    const image = generateImage(4, 4, () => [0, 0, 0, 255]);
    assert.doesNotThrow(() => createImageTexture(gpu, image, { maxTextureDimension2D: 0 }).destroy());
    gpu.dispose();
  });
});

describe("ImageDiffComponent", () => {
  const pair = ingestPair(
    generateImage(8, 8, () => [255, 0, 0, 255]),
    generateImage(8, 8, (x) => (x < 4 ? [0, 0, 255, 255] : [255, 0, 0, 255])),
  );

  it("runs create/update/plan/dispose against a mock Gpu", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new ImageDiffComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ pair, viewport: VIEWPORT, mode: "difference" });

    const plan = component.plan();
    assert.equal(plan.renderPasses.length, 1);
    assert.equal(plan.computePasses.length, 1, "stats run once for a new pair");

    for (const p of plan.computePasses) p.dispatch();
    frame(gpu, (f) => {
      f.pass({ target: surfaceTarget, clear: true }, (fp) => {
        for (const p of plan.renderPasses) p.encode(gpuPass(fp));
      });
    });

    component.dispose();
    gpu.dispose();
  });

  it("recomputes stats only when the images change, not when the view does", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new ImageDiffComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });

    component.update({ pair, viewport: VIEWPORT });
    assert.equal(component.plan().computePasses.length, 1);

    // Panning and changing mode must not re-run a whole-image compute pass.
    component.update({ pair, viewport: { ...VIEWPORT, timeStart: 1, timeEnd: 9 }, mode: "heat" });
    assert.equal(component.plan().computePasses.length, 0);

    const other = ingestPair(pair.after, pair.before);
    component.update({ pair: other, viewport: VIEWPORT });
    assert.equal(component.plan().computePasses.length, 1, "new images, new count");

    component.dispose();
    gpu.dispose();
  });

  it("hit-tests a screen position back to an image pixel", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new ImageDiffComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    component.update({ pair, viewport: VIEWPORT });

    // 8x8 image over a 16x16 surface: 2 screen pixels per image pixel.
    assert.deepEqual(component.hitTest(0, 0), { id: 0 });
    assert.deepEqual(component.hitTest(15, 0), { id: 7 });
    assert.deepEqual(component.hitTest(0, 15), { id: 7 * 8 });
    assert.equal(component.hitTest(100, 0), null);

    component.dispose();
    gpu.dispose();
  });

  it("contributes nothing before the first update", async () => {
    const { gpu, caps } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [16, 16] });
    const component = new ImageDiffComponent();
    component.create({ ...makeCtx(gpu, surfaceTarget), caps });
    assert.deepEqual(component.plan().renderPasses, []);
    component.dispose();
    gpu.dispose();
  });
});
