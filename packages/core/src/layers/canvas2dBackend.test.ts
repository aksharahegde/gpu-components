import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockGpu, createRecordingContext2D } from "@gpu-components/testing";
import { CANVAS2D_CAPS, type Canvas2DPassEncoder } from "../passEncoder.ts";
import { viewportUniforms } from "../viewport.ts";
import { InstancedQuadLayer, type QuadFallbackPolicy } from "./instancedQuad.ts";
import { LINE_FLAG_CLIP_X, LINE_FLAG_CLIP_Y, LineLayer, packRgba8 } from "./lineLayer.ts";
import { RasterLayer } from "./rasterLayer.ts";

const SHADER = /* wgsl */ `
struct Instance { x: f32, y: f32, w: f32, color: u32 }
@group(0) @binding(0) var<uniform> viewport: f32;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@vertex fn vs_main(@builtin(vertex_index) i: u32, @builtin(instance_index) n: u32) -> @builtin(position) vec4f {
  return vec4f(instances[n].x, 0.0, 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }
`;

const RASTER_SHADER = /* wgsl */ `
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f { return vec4f(uv, 0.0, 1.0); }
`;

const VIEWPORT = viewportUniforms({
  timeStart: 0,
  timeEnd: 100,
  trackCount: 4,
  width: 200,
  height: 100,
});

/** 16-byte instances: clip-space x0/x1 in the first two floats, packed colour in the last word. */
const STRIDE = 16;
const quadPolicy: QuadFallbackPolicy = {
  decode: (view, index) => ({
    x0: view.getFloat32(index * STRIDE + 0, true),
    y0: -1,
    x1: view.getFloat32(index * STRIDE + 4, true),
    y1: 1,
    color: view.getUint32(index * STRIDE + 12, true),
  }),
};

function packQuads(specs: readonly { x0: number; x1: number; color: number }[]) {
  const bytes = new Uint8Array(new ArrayBuffer(specs.length * STRIDE));
  const view = new DataView(bytes.buffer);
  specs.forEach((s, i) => {
    view.setFloat32(i * STRIDE + 0, s.x0, true);
    view.setFloat32(i * STRIDE + 4, s.x1, true);
    view.setUint32(i * STRIDE + 12, s.color, true);
  });
  return bytes;
}

function makePass(): { pass: Canvas2DPassEncoder; recorder: ReturnType<typeof createRecordingContext2D>; reports: string[] } {
  const recorder = createRecordingContext2D();
  const reports: string[] = [];
  return {
    recorder,
    reports,
    pass: {
      kind: "canvas2d",
      ctx: recorder.ctx,
      width: 200,
      height: 100,
      viewport: VIEWPORT,
      report: (reason) => reports.push(reason),
    },
  };
}

describe("InstancedQuadLayer — Canvas2D backend", () => {
  it("draws one fillRect per instance, converting clip space to CSS pixels", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder } = makePass();
    const layer = new InstancedQuadLayer({
      gpu,
      shader: SHADER,
      instanceStride: STRIDE,
      capacity: 4,
      fallback: quadPolicy,
    });

    // Clip [-1, 0] is the left half of a 200px-wide surface.
    layer.upload(packQuads([{ x0: -1, x1: 0, color: packRgba8(255, 0, 0) }]), 1);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 1);
    const rect = recorder.calls[0]!;
    assert.equal(rect.op, "fillRect");
    if (rect.op !== "fillRect") return;
    assert.equal(rect.x, 0);
    assert.equal(rect.w, 100);
    assert.equal(rect.fillStyle, "rgb(255,0,0)");

    gpu.dispose();
  });

  it("batches fillStyle into runs rather than setting it per quad", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder } = makePass();
    const layer = new InstancedQuadLayer({
      gpu,
      shader: SHADER,
      instanceStride: STRIDE,
      capacity: 8,
      fallback: quadPolicy,
    });

    const red = packRgba8(255, 0, 0);
    const blue = packRgba8(0, 0, 255);
    layer.upload(
      packQuads([
        { x0: -1, x1: 0, color: red },
        { x0: -1, x1: 0, color: red },
        { x0: 0, x1: 1, color: blue },
        { x0: 0, x1: 1, color: blue },
      ]),
      4,
    );
    layer.draw(pass);

    assert.equal(recorder.calls.length, 4, "one fillRect per quad");
    assert.deepEqual(recorder.fillStyleRuns, ["rgb(255,0,0)", "rgb(0,0,255)"], "two runs, not four");

    gpu.dispose();
  });

  it("skips instances whose decode returns null — the fallback's culling", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder } = makePass();
    const layer = new InstancedQuadLayer({
      gpu,
      shader: SHADER,
      instanceStride: STRIDE,
      capacity: 4,
      fallback: { decode: (_v, index) => (index % 2 === 0 ? null : { x0: 0, y0: 0, x1: 1, y1: 1, color: 0 }) },
    });

    layer.upload(packQuads(Array.from({ length: 4 }, () => ({ x0: 0, x1: 1, color: 0 }))), 4);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 2);
    gpu.dispose();
  });

  it("downsamples above the cap and reports it, rather than truncating", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder, reports } = makePass();
    const count = CANVAS2D_CAPS.quads * 2;
    const layer = new InstancedQuadLayer({
      gpu,
      shader: SHADER,
      instanceStride: STRIDE,
      capacity: count,
      fallback: quadPolicy,
      label: "spans",
    });

    layer.upload(new Uint8Array(new ArrayBuffer(count * STRIDE)), count);
    layer.draw(pass);

    assert.equal(recorder.calls.length, CANVAS2D_CAPS.quads, "drew exactly the budget");
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /exceeds the Canvas2D budget/);
    assert.match(reports[0]!, /every 2th/);

    gpu.dispose();
  });

  it("reports instead of silently drawing nothing when no fallback policy was given", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder, reports } = makePass();
    const layer = new InstancedQuadLayer({ gpu, shader: SHADER, instanceStride: STRIDE, capacity: 4 });

    layer.upload(packQuads([{ x0: -1, x1: 0, color: 0 }]), 1);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 0);
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /no Canvas2D fallback policy/);

    gpu.dispose();
  });

  it("gpu: null draws identically to the gpu-present case", () => {
    const { pass, recorder } = makePass();
    const layer = new InstancedQuadLayer({ gpu: null, shader: SHADER, instanceStride: STRIDE, capacity: 4, fallback: quadPolicy });

    layer.upload(packQuads([{ x0: -1, x1: 0, color: packRgba8(255, 0, 0) }]), 1);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 1);
    const rect = recorder.calls[0]!;
    assert.equal(rect.op, "fillRect");
    if (rect.op !== "fillRect") return;
    assert.equal(rect.x, 0);
    assert.equal(rect.w, 100);
    assert.equal(rect.fillStyle, "rgb(255,0,0)");
  });

  it("gpu: null with no fallback policy reports once at construction, not per frame", () => {
    const warnings: { code: string; source: string; message: string }[] = [];
    const layer = new InstancedQuadLayer({
      gpu: null,
      shader: SHADER,
      instanceStride: STRIDE,
      capacity: 4,
      label: "no-policy",
      warnings: { report: (w) => warnings.push(w), recent: [], onWarning: () => () => {}, dispose: () => {} },
    });

    const { pass, recorder } = makePass();
    layer.upload(packQuads([{ x0: -1, x1: 0, color: 0 }]), 1);
    layer.draw(pass);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 0);
    assert.equal(warnings.length, 1, "reported once, at construction");
    assert.equal(warnings[0]!.code, "no-canvas2d-policy");
    assert.equal(warnings[0]!.source, "no-policy");
  });

  it("does not alias the caller's scratch buffer", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder } = makePass();
    const layer = new InstancedQuadLayer({
      gpu,
      shader: SHADER,
      instanceStride: STRIDE,
      capacity: 4,
      fallback: quadPolicy,
    });

    // Upload, then overwrite the same buffer the way a component reusing scratch would.
    const scratch = packQuads([{ x0: -1, x1: 0, color: packRgba8(255, 0, 0) }]);
    layer.upload(scratch, 1);
    new DataView(scratch.buffer).setUint32(12, packRgba8(0, 255, 0), true);

    layer.draw(pass);
    const rect = recorder.calls[0]!;
    assert.equal(rect.op === "fillRect" && rect.fillStyle, "rgb(255,0,0)", "must draw what was uploaded");

    gpu.dispose();
  });
});

describe("LineLayer — Canvas2D backend", () => {
  it("strokes domain-space endpoints through the same viewport transform as the shader", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder } = makePass();
    const layer = new LineLayer({ gpu, capacity: 8 });

    // A vertical gridline at t=50 on a [0,100] domain over 200px lands at x=100.
    layer.uploadLines([
      { x0: 50, y0: -1, x1: 50, y1: 1, widthPx: 2, color: packRgba8(255, 255, 255, 128), flags: LINE_FLAG_CLIP_Y },
    ]);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 1);
    const stroke = recorder.calls[0]!;
    assert.equal(stroke.op, "stroke");
    if (stroke.op !== "stroke") return;
    assert.equal(stroke.x0, 100);
    assert.equal(stroke.x1, 100);
    // The instance runs y0=-1 → y1=+1, and clip +1 is the *top*, so the pixel endpoints invert:
    // y0 lands at the bottom (100) and y1 at the top (0).
    assert.equal(stroke.y0, 100);
    assert.equal(stroke.y1, 0);
    assert.equal(stroke.lineWidth, 2);
    assert.match(stroke.strokeStyle, /^rgba\(255,255,255,/);

    gpu.dispose();
  });

  it("honours the clip-space flag per axis", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder } = makePass();
    const layer = new LineLayer({ gpu, capacity: 8 });

    // A track separator: x spans the full width in clip space, y is a track row.
    layer.uploadLines([
      { x0: -1, y0: 0.5, x1: 1, y1: 0.5, widthPx: 1, color: 0xffffffff, flags: LINE_FLAG_CLIP_X },
    ]);
    layer.draw(pass);

    const stroke = recorder.calls[0]!;
    if (stroke.op !== "stroke") throw new Error("expected a stroke");
    assert.equal(stroke.x0, 0);
    assert.equal(stroke.x1, 200, "full width");
    assert.equal(stroke.y0, stroke.y1, "horizontal");
    assert.ok(stroke.y0 > 0 && stroke.y0 < 100, `row boundary should be inside the surface, got ${stroke.y0}`);

    gpu.dispose();
  });

  it("gpu: null strokes identically to the gpu-present case", () => {
    const { pass, recorder } = makePass();
    const layer = new LineLayer({ gpu: null, capacity: 8 });

    layer.uploadLines([
      { x0: 50, y0: -1, x1: 50, y1: 1, widthPx: 2, color: packRgba8(255, 255, 255, 128), flags: LINE_FLAG_CLIP_Y },
    ]);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 1);
    const stroke = recorder.calls[0]!;
    assert.equal(stroke.op, "stroke");
    if (stroke.op !== "stroke") return;
    assert.equal(stroke.x0, 100);
    assert.equal(stroke.x1, 100);
  });

  it("needs no fallback policy — core owns the LineInstance layout", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder, reports } = makePass();
    const layer = new LineLayer({ gpu, capacity: 4 });

    layer.uploadLines([{ x0: 0, y0: 0, x1: 1, y1: 1, widthPx: 1, color: 0 }]);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 1);
    assert.deepEqual(reports, [], "no degradation to report at one line");

    gpu.dispose();
  });

  it("downsamples above the segment cap and reports it", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder, reports } = makePass();
    const count = CANVAS2D_CAPS.lineSegments * 3;
    const layer = new LineLayer({ gpu, capacity: count, label: "edges" });

    layer.uploadLines(
      Array.from({ length: count }, (_, i) => ({ x0: i, y0: 0, x1: i, y1: 1, widthPx: 1, color: 0 })),
    );
    layer.draw(pass);

    assert.equal(recorder.calls.length, CANVAS2D_CAPS.lineSegments);
    assert.match(reports[0]!, /edges: \d+ segments exceeds/);

    gpu.dispose();
  });
});

describe("RasterLayer — Canvas2D backend", () => {
  it("shades into a reused ImageData and puts it at the origin", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder } = makePass();
    let shadeCalls = 0;
    const layer = new RasterLayer({
      gpu,
      shader: RASTER_SHADER,
      fallback: {
        shade: (rgba) => {
          shadeCalls++;
          rgba[3] = 255;
        },
      },
    });

    layer.draw(pass);
    layer.draw(pass);

    assert.equal(shadeCalls, 2);
    assert.equal(recorder.calls.length, 2);
    const put = recorder.calls[0]!;
    assert.equal(put.op, "putImageData");
    if (put.op !== "putImageData") return;
    assert.equal(put.width, 200);
    assert.equal(put.height, 100);
    assert.equal(put.firstPixelAlpha, 255, "the shade callback's write must reach putImageData");

    gpu.dispose();
  });

  it("reports rather than drawing nothing silently without a policy", async () => {
    const { gpu } = await createMockGpu();
    const { pass, recorder, reports } = makePass();
    const layer = new RasterLayer({ gpu, shader: RASTER_SHADER, label: "density" });

    layer.draw(pass);

    assert.equal(recorder.calls.length, 0);
    assert.match(reports[0]!, /density: no Canvas2D fallback policy/);

    gpu.dispose();
  });

  it("gpu: null shades identically to the gpu-present case", () => {
    const { pass, recorder } = makePass();
    let shadeCalls = 0;
    const layer = new RasterLayer({
      gpu: null,
      shader: RASTER_SHADER,
      fallback: {
        shade: (rgba) => {
          shadeCalls++;
          rgba[3] = 255;
        },
      },
    });

    layer.draw(pass);

    assert.equal(shadeCalls, 1);
    assert.equal(recorder.calls.length, 1);
  });

  it("gpu: null with no fallback policy reports once at construction", () => {
    const warnings: { code: string; source: string; message: string }[] = [];
    const layer = new RasterLayer({
      gpu: null,
      shader: RASTER_SHADER,
      label: "density",
      warnings: { report: (w) => warnings.push(w), recent: [], onWarning: () => () => {}, dispose: () => {} },
    });
    const { pass, recorder } = makePass();

    layer.draw(pass);
    layer.draw(pass);

    assert.equal(recorder.calls.length, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]!.code, "no-canvas2d-policy");
  });
});
