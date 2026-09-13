import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockGpu } from "@gpuc/testing";
import { createProfiler } from "./profiler.ts";

describe("createProfiler", () => {
  it("with GPU timing off: span() is inert, but CPU frame stats still work", async () => {
    const { gpu } = await createMockGpu();
    const profiler = createProfiler(gpu, false);

    assert.equal(profiler.enabled, false);
    assert.equal(profiler.span("some-pass"), undefined);
    assert.equal(profiler.lastFrame, null);

    const stats = { cpuMs: 1.5, componentCount: 2, passCount: 3, dispatchCount: 1 };
    profiler.recordFrame(stats);
    assert.deepEqual(profiler.lastFrame, stats);

    // onGpuResults is a no-op subscription, not an error, when disabled.
    const unsub = profiler.onGpuResults(() => {
      throw new Error("should never fire when disabled");
    });
    unsub();

    profiler.dispose();
    gpu.dispose();
  });

  it("with GPU timing on (timestamp-query granted): span() returns a real TimerSpan", async () => {
    const { gpu } = await createMockGpu(["timestamp-query"]);
    const profiler = createProfiler(gpu, true);

    assert.equal(profiler.enabled, true);
    const span = profiler.span("some-pass");
    assert.ok(span, "expected a TimerSpan, not undefined, once GPU timing is enabled");

    // vgpu/mock validates wiring, not real decoded GPU timing (this session's established
    // precedent for compute/atomics too) — onGpuResults/dispose just must not throw.
    const unsub = profiler.onGpuResults(() => {});
    unsub();
    profiler.dispose();
    gpu.dispose();
  });
});
