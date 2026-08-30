import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createVelocityTracker, decayVelocity, INERTIA_STOP_VELOCITY } from "./inertia.ts";

describe("createVelocityTracker", () => {
  it("estimates velocity as delta/dt for a single sample", () => {
    const tracker = createVelocityTracker();
    tracker.record(50, 10); // 50px over 10ms -> 5px/ms
    assert.ok(Math.abs(tracker.velocity() - 5) < 1e-9);
  });

  it("smooths across samples rather than jumping straight to the newest one", () => {
    const tracker = createVelocityTracker();
    tracker.record(50, 10); // 5px/ms
    tracker.record(10, 10); // 1px/ms — a sudden slowdown
    const v = tracker.velocity();
    assert.ok(v > 1 && v < 5, `expected a smoothed value between 1 and 5, got ${v}`);
  });

  it("ignores non-positive dt (no divide-by-zero, no state corruption)", () => {
    const tracker = createVelocityTracker();
    tracker.record(50, 10);
    const before = tracker.velocity();
    tracker.record(999, 0);
    assert.equal(tracker.velocity(), before);
  });

  it("reset() zeroes the estimate", () => {
    const tracker = createVelocityTracker();
    tracker.record(50, 10);
    tracker.reset();
    assert.equal(tracker.velocity(), 0);
  });
});

describe("decayVelocity", () => {
  it("halves the velocity after exactly one half-life", () => {
    assert.ok(Math.abs(decayVelocity(10, 200, 200) - 5) < 1e-9);
  });

  it("is a no-op at dt=0", () => {
    assert.equal(decayVelocity(10, 0, 200), 10);
  });

  it("preserves sign (pans left keep decaying left, not flipping direction)", () => {
    assert.ok(decayVelocity(-10, 50, 200) < 0);
  });

  it("eventually decays below INERTIA_STOP_VELOCITY", () => {
    let v = 10;
    for (let i = 0; i < 1000 && Math.abs(v) >= INERTIA_STOP_VELOCITY; i++) {
      v = decayVelocity(v, 16, 200);
    }
    assert.ok(Math.abs(v) < INERTIA_STOP_VELOCITY);
  });
});
