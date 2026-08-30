import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { brushRectFromPixels } from "./brush.ts";

const VIEWPORT = { timeStart: 0, timeEnd: 10, trackCount: 4, width: 1000, height: 400 };

describe("brushRectFromPixels", () => {
  it("maps pixel corners to the matching time/track range", () => {
    // width 1000 over time [0,10]: 100px per time unit. height 400 over 4 tracks: 100px per track.
    const rect = brushRectFromPixels(VIEWPORT, 200, 50, 500, 150);
    assert.ok(Math.abs(rect.timeStart - 2) < 1e-9);
    assert.ok(Math.abs(rect.timeEnd - 5) < 1e-9);
    assert.equal(rect.trackMin, 0);
    assert.equal(rect.trackMax, 1);
  });

  it("normalizes a reversed drag (bottom-right to top-left) the same as a forward one", () => {
    const forward = brushRectFromPixels(VIEWPORT, 200, 50, 500, 150);
    const reversed = brushRectFromPixels(VIEWPORT, 500, 150, 200, 50);
    assert.deepEqual(reversed, forward);
  });

  it("clamps track range to [0, trackCount - 1]", () => {
    const rect = brushRectFromPixels(VIEWPORT, 0, -1000, 100, 10_000);
    assert.equal(rect.trackMin, 0);
    assert.equal(rect.trackMax, VIEWPORT.trackCount - 1);
  });

  it("a zero-size drag produces a zero-width, single-track rect, not an error", () => {
    const rect = brushRectFromPixels(VIEWPORT, 300, 150, 300, 150);
    assert.equal(rect.timeStart, rect.timeEnd);
    assert.equal(rect.trackMin, rect.trackMax);
  });
});
