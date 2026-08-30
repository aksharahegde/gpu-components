import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertBufferBudget, dispatchWorkgroups, GpuBudgetExceededError, maxElementsFor } from "./budget.ts";
import { createWarningsLog } from "./warnings.ts";

const CAPS = {
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxComputeWorkgroupsPerDimension: 65535,
};

describe("assertBufferBudget", () => {
  it("allows an allocation inside the device limits", () => {
    assert.doesNotThrow(() => assertBufferBudget(CAPS, 64 * 1024 * 1024, "spans"));
  });

  it("throws a typed error carrying requested and available bytes", () => {
    // §14.3: "a typed GpuBudgetExceededError (carrying requested vs available bytes)".
    try {
      assertBufferBudget(CAPS, 200 * 1024 * 1024, "GPUTimeline spans", 32);
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof GpuBudgetExceededError);
      assert.equal(error.resource, "GPUTimeline spans");
      assert.equal(error.requestedBytes, 200 * 1024 * 1024);
      assert.equal(error.availableBytes, 128 * 1024 * 1024, "the smaller of the two limits binds");
      assert.equal(error.maxElements, (128 * 1024 * 1024) / 32);
      // The message must name the numbers, not just fail (§24.2: "not a silent GPU crash").
      assert.match(error.message, /200\.0 MiB/);
      assert.match(error.message, /128\.0 MiB/);
      assert.match(error.message, /4,194,304 elements/);
    }
  });

  it("binds on whichever limit is smaller", () => {
    const tight = { maxStorageBufferBindingSize: 512 * 1024 * 1024, maxBufferSize: 16 * 1024 * 1024 };
    try {
      assertBufferBudget(tight, 32 * 1024 * 1024, "values");
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal((error as GpuBudgetExceededError).availableBytes, 16 * 1024 * 1024);
    }
  });

  it("treats zero limits as unprobed rather than as forbidding everything", () => {
    // NO_WEBGPU_CAPABILITIES has zeroes, and mock/test capabilities often do too. Failing there
    // would break every component in tests while protecting nothing.
    assert.doesNotThrow(() =>
      assertBufferBudget({ maxStorageBufferBindingSize: 0, maxBufferSize: 0 }, 1e12, "anything"),
    );
  });

  it("rejects a non-finite or negative size instead of passing it to the driver", () => {
    assert.throws(() => assertBufferBudget(CAPS, Number.NaN, "spans"), GpuBudgetExceededError);
    assert.throws(() => assertBufferBudget(CAPS, -1, "spans"), GpuBudgetExceededError);
  });
});

describe("maxElementsFor", () => {
  it("reports how many elements fit at a given stride", () => {
    assert.equal(maxElementsFor(CAPS, 32), (128 * 1024 * 1024) / 32);
  });

  it("is unbounded when limits are unprobed", () => {
    assert.equal(maxElementsFor({ maxStorageBufferBindingSize: 0, maxBufferSize: 0 }, 32), Number.MAX_SAFE_INTEGER);
  });
});

describe("dispatchWorkgroups", () => {
  it("returns the natural count when it fits", () => {
    assert.equal(dispatchWorkgroups(CAPS, 1000, 64), Math.ceil(1000 / 64));
  });

  it("clamps a dispatch that would exceed the device limit", () => {
    // The exact denial-of-service §24.2 names: ~4.2M spans at 64 per workgroup is 65,536
    // workgroups, one past the common 65,535 limit, and WebGPU rejects the whole dispatch.
    const itemCount = 65_536 * 64;
    assert.equal(dispatchWorkgroups(CAPS, itemCount, 64), 65_535);
  });

  it("reports the clamp rather than silently dropping data", () => {
    const warnings = createWarningsLog();
    const itemCount = 65_536 * 64;
    dispatchWorkgroups(CAPS, itemCount, 64, { warnings, source: "timeline-cull" });

    assert.equal(warnings.recent.length, 1);
    assert.equal(warnings.recent[0]!.code, "dispatch-clamped");
    assert.equal(warnings.recent[0]!.source, "timeline-cull");
    assert.match(warnings.recent[0]!.message, /64 items were not processed/);
  });

  it("stays silent when nothing is clamped", () => {
    const warnings = createWarningsLog();
    dispatchWorkgroups(CAPS, 1000, 64, { warnings, source: "timeline-cull" });
    assert.deepEqual(warnings.recent, []);
  });

  it("returns zero for an empty or non-finite count", () => {
    assert.equal(dispatchWorkgroups(CAPS, 0, 64), 0);
    assert.equal(dispatchWorkgroups(CAPS, Number.NaN, 64), 0);
    assert.equal(dispatchWorkgroups(CAPS, -5, 64), 0);
  });

  it("does not clamp when the limit is unprobed", () => {
    assert.equal(dispatchWorkgroups({ maxComputeWorkgroupsPerDimension: 0 }, 1e6, 64), Math.ceil(1e6 / 64));
  });
});
