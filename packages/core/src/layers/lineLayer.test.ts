import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockGpu } from "@gpuc/testing";
import { createWarningsLog } from "../warnings.ts";
import {
  LINE_FLAG_CLIP_X,
  LINE_FLAG_CLIP_Y,
  LINE_INSTANCE_STRIDE,
  LineLayer,
  packLines,
  packRgba8,
  writeLine,
} from "./lineLayer.ts";

describe("packRgba8", () => {
  it("packs to 0xRRGGBBAA and stays unsigned at full white", () => {
    assert.equal(packRgba8(0x11, 0x22, 0x33, 0x44), 0x11223344);
    // The naive `<<24` form goes negative here; the shader unpacks a u32, so it must not.
    assert.equal(packRgba8(255, 255, 255, 255), 0xffffffff);
    assert.ok(packRgba8(255, 0, 0) > 0, "opaque red must stay positive");
  });

  it("defaults alpha to opaque", () => {
    assert.equal(packRgba8(0, 0, 0), 0x000000ff);
  });
});

describe("writeLine / packLines", () => {
  it("lays fields out at the byte offsets the WGSL struct expects", () => {
    const { bytes, count } = packLines([
      { x0: 1.5, y0: 2, x1: 3.5, y1: 4, widthPx: 2, color: packRgba8(255, 0, 0), flags: LINE_FLAG_CLIP_Y },
    ]);

    assert.equal(count, 1);
    assert.equal(bytes.byteLength, LINE_INSTANCE_STRIDE);

    const view = new DataView(bytes.buffer);
    assert.equal(view.getFloat32(0, true), 1.5);
    assert.equal(view.getFloat32(4, true), 2);
    assert.equal(view.getFloat32(8, true), 3.5);
    assert.equal(view.getFloat32(12, true), 4);
    assert.equal(view.getFloat32(16, true), 2);
    assert.equal(view.getUint32(20, true), 0xff0000ff);
    assert.equal(view.getUint32(24, true), LINE_FLAG_CLIP_Y);
    assert.equal(view.getUint32(28, true), 0, "padding word must be zeroed");
  });

  it("defaults flags to 0 — plain domain-space endpoints", () => {
    const { bytes } = packLines([{ x0: 0, y0: 0, x1: 1, y1: 1, widthPx: 1, color: 0 }]);
    assert.equal(new DataView(bytes.buffer).getUint32(24, true), 0);
  });

  it("writes each line at its own stride offset", () => {
    const bytes = new Uint8Array(3 * LINE_INSTANCE_STRIDE);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 3; i++) {
      writeLine(view, i, { x0: i, y0: 0, x1: i, y1: 1, widthPx: 1, color: 0, flags: LINE_FLAG_CLIP_X });
    }
    for (let i = 0; i < 3; i++) {
      assert.equal(view.getFloat32(i * LINE_INSTANCE_STRIDE, true), i);
    }
  });
});

describe("LineLayer", () => {
  it("compiles its built-in shader and uploads without a VGPU error", async () => {
    const { gpu } = await createMockGpu();
    const layer = new LineLayer({ gpu, capacity: 4, label: "rules" });

    assert.doesNotThrow(() => {
      layer.uploadLines([
        { x0: 0, y0: -1, x1: 0, y1: 1, widthPx: 1, color: packRgba8(80, 80, 80), flags: LINE_FLAG_CLIP_Y },
        { x0: 5, y0: -1, x1: 5, y1: 1, widthPx: 1, color: packRgba8(80, 80, 80), flags: LINE_FLAG_CLIP_Y },
      ]);
    });

    await gpu.settled();
    gpu.dispose();
  });

  it("inherits the buffer-growth warning from the quad layer it composes", async () => {
    const { gpu } = await createMockGpu();
    const warnings = createWarningsLog();
    const layer = new LineLayer({ gpu, capacity: 1, warnings, label: "rules" });

    const line = { x0: 0, y0: 0, x1: 1, y1: 1, widthPx: 1, color: 0 };
    layer.uploadLines([line, line]); // growth 1 — not reported
    assert.equal(warnings.recent.length, 0);
    layer.uploadLines([line, line, line, line]); // growth 2 — reported
    assert.equal(warnings.recent.length, 1);
    assert.equal(warnings.recent[0]!.code, "buffer-growth");
    assert.equal(warnings.recent[0]!.source, "rules");

    gpu.dispose();
  });

  it("draws nothing before any upload", async () => {
    const { gpu } = await createMockGpu();
    const layer = new LineLayer({ gpu, capacity: 4 });
    let drawCalls = 0;
    const pass = { draw: () => { drawCalls++; } } as never;

    layer.draw(pass);
    assert.equal(drawCalls, 0, "an empty layer must contribute no draw");

    gpu.dispose();
  });
});
