import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockGpu } from "@gpu-components/testing";
import { createWarningsLog } from "./warnings.ts";
import { trackedUniforms } from "./trackedUniforms.ts";

describe("trackedUniforms", () => {
  it("does not report before crossing the unchanged-streak threshold", async () => {
    const { gpu } = await createMockGpu();
    const warnings = createWarningsLog();
    const u = trackedUniforms(gpu, { x: 1 }, warnings, "test-source");

    for (let i = 0; i < 29; i++) u.set({ x: 1 });
    assert.equal(warnings.recent.length, 0);

    gpu.dispose();
  });

  it("reports once the unchanged-streak threshold is crossed, then keeps counting via WarningsLog", async () => {
    const { gpu } = await createMockGpu();
    const warnings = createWarningsLog();
    const u = trackedUniforms(gpu, { x: 1 }, warnings, "test-source");

    for (let i = 0; i < 31; i++) u.set({ x: 1 });

    assert.equal(warnings.recent.length, 1);
    assert.equal(warnings.recent[0]!.code, "redundant-uniform-write");
    assert.equal(warnings.recent[0]!.source, "test-source");

    gpu.dispose();
  });

  it("never reports when the value actually changes every call", async () => {
    const { gpu } = await createMockGpu();
    const warnings = createWarningsLog();
    const u = trackedUniforms(gpu, { x: 0 }, warnings, "test-source");

    for (let i = 0; i < 50; i++) u.set({ x: i });
    assert.equal(warnings.recent.length, 0);

    gpu.dispose();
  });

  it("still forwards every set() to the real underlying vgpu uniform", async () => {
    const { gpu } = await createMockGpu();
    const { target, frame, draw } = await import("vgpu");
    const warnings = createWarningsLog();
    const u = trackedUniforms(gpu, { x: 1 }, warnings, "test-source");

    // Bind it into a real draw and encode a frame against the mock device — if `set()` didn't
    // really forward to vgpu's own uniform, binding/encoding would throw (unbound resource).
    const shader = /* wgsl */ `
      struct U { x: f32 }
      @group(0) @binding(0) var<uniform> u: U;
      @vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }
      @fragment fn fs_main() -> @location(0) vec4f { return vec4f(u.x, 0.0, 0.0, 1.0); }
    `;
    const t = target(gpu, { size: [2, 2] });
    const d = draw(gpu, { shader, vertices: 3 });
    d.set({ u });
    u.set({ x: 0.5 });

    assert.doesNotThrow(() => {
      frame(gpu, (f) => {
        f.pass({ target: t, clear: true }, (pass) => pass.draw(d));
      });
    });

    gpu.dispose();
  });
});
