import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { timeToPixelX } from "../viewport.ts";
import { createViewportController } from "./viewportController.ts";

const INITIAL = { timeStart: 0, timeEnd: 10, trackCount: 1, width: 1000, height: 100 };
const BOUNDS = { timeMin: 0, timeMax: 10 };

describe("createViewportController", () => {
  it("zoomAt keeps the time value under the cursor fixed on screen", () => {
    const controller = createViewportController(INITIAL, BOUNDS);
    const pixelX = 300;
    const targetTime = 3; // timeToPixelX(INITIAL, 3) === 300

    controller.zoomAt(pixelX, 0.5);
    const after = controller.getState();
    assert.ok(
      Math.abs(timeToPixelX(after, targetTime) - pixelX) < 1e-6,
      `expected pixel ${pixelX} to still map to time ${targetTime}, got ${timeToPixelX(after, targetTime)}`,
    );
    // Zoomed in: the visible span shrank.
    assert.ok(after.timeEnd - after.timeStart < INITIAL.timeEnd - INITIAL.timeStart);
  });

  it("zoomAt never widens past the bounds", () => {
    const controller = createViewportController(INITIAL, BOUNDS);
    controller.zoomAt(500, 100); // a huge zoom-out factor
    const after = controller.getState();
    assert.ok(after.timeStart >= BOUNDS.timeMin - 1e-9);
    assert.ok(after.timeEnd <= BOUNDS.timeMax + 1e-9);
    assert.ok(after.timeEnd - after.timeStart <= BOUNDS.timeMax - BOUNDS.timeMin + 1e-9);
  });

  it("panByPixels shifts the domain by the expected time delta, clamped to bounds", () => {
    const narrow = { ...INITIAL, timeStart: 2, timeEnd: 4 }; // span 2, width 1000 -> 500px/time-unit
    const controller = createViewportController(narrow, BOUNDS);
    controller.panByPixels(100); // 100px * (2/1000) = 0.2 time units
    const after = controller.getState();
    assert.ok(Math.abs(after.timeStart - 2.2) < 1e-9);
    assert.ok(Math.abs(after.timeEnd - 4.2) < 1e-9);
  });

  it("panByPixels clamps at the domain edges instead of panning past them", () => {
    const atEnd = { ...INITIAL, timeStart: 8, timeEnd: 10 };
    const controller = createViewportController(atEnd, BOUNDS);
    controller.panByPixels(10_000); // a huge pan past the right edge
    const after = controller.getState();
    assert.equal(after.timeEnd, BOUNDS.timeMax);
    assert.equal(after.timeStart, BOUNDS.timeMax - 2);
  });

  it("resize updates width/height without touching the time domain", () => {
    const controller = createViewportController(INITIAL, BOUNDS);
    controller.resize(1200, 300);
    const after = controller.getState();
    assert.equal(after.width, 1200);
    assert.equal(after.height, 300);
    assert.equal(after.timeStart, INITIAL.timeStart);
    assert.equal(after.timeEnd, INITIAL.timeEnd);
  });
});
