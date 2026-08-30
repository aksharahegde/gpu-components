import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockGpu } from "@gpu-components/testing";
import { createWarningsLog } from "../warnings.ts";
import { InstancedQuadLayer } from "./instancedQuad.ts";

const SHADER = /* wgsl */ `
struct Instance { x: f32 }
@group(0) @binding(0) var<uniform> viewport: f32;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@vertex fn vs_main(@builtin(vertex_index) i: u32, @builtin(instance_index) inst: u32) -> @builtin(position) vec4f {
  return vec4f(instances[inst].x, 0.0, 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }
`;

describe("InstancedQuadLayer buffer-growth detection", () => {
  it("reports nothing on the first capacity growth", async () => {
    const { gpu } = await createMockGpu();
    const warnings = createWarningsLog();
    const layer = new InstancedQuadLayer({
      gpu,
      shader: SHADER,
      instanceStride: 4,
      capacity: 1,
      warnings,
      label: "test-layer",
    });

    const bytes = new Uint8Array(4 * 4); // 4 instances, stride 4
    layer.upload(bytes, 4); // exceeds initial capacity 1 -> first growth

    assert.equal(warnings.recent.length, 0, "the first growth should not be reported");
    gpu.dispose();
  });

  it("reports a buffer-growth warning from the second growth onward, tagged with the layer's label", async () => {
    const { gpu } = await createMockGpu();
    const warnings = createWarningsLog();
    const layer = new InstancedQuadLayer({
      gpu,
      shader: SHADER,
      instanceStride: 4,
      capacity: 1,
      warnings,
      label: "test-layer",
    });

    layer.upload(new Uint8Array(4 * 4), 4); // growth 1 (not reported)
    layer.upload(new Uint8Array(4 * 8), 8); // growth 2 (reported)

    assert.equal(warnings.recent.length, 1);
    assert.equal(warnings.recent[0]!.code, "buffer-growth");
    assert.equal(warnings.recent[0]!.source, "test-layer");
    assert.match(warnings.recent[0]!.message, /4 -> 8/);

    gpu.dispose();
  });

  it("does not throw when constructed without a warnings sink", async () => {
    const { gpu } = await createMockGpu();
    const layer = new InstancedQuadLayer({ gpu, shader: SHADER, instanceStride: 4, capacity: 1 });
    assert.doesNotThrow(() => {
      layer.upload(new Uint8Array(4 * 4), 4);
      layer.upload(new Uint8Array(4 * 8), 8);
    });
    gpu.dispose();
  });
});
