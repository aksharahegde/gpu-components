import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pixelXToTime,
  pixelYToTrack,
  timeToPixelX,
  trackRowHeight,
  trackToPixelY,
  viewportUniforms,
} from "./viewport.ts";

const V = { timeStart: 0, timeEnd: 10, trackCount: 4, width: 800, height: 400 };

describe("viewport", () => {
  it("maps the domain edges to clip space [-1, 1]", () => {
    const u = viewportUniforms(V);
    const [scale, offset] = u.timeToClip;
    assert.equal(0 * scale + offset, -1);
    assert.equal(10 * scale + offset, 1);
  });

  it("maps track centers from top (+1-ish) to bottom (-1-ish)", () => {
    const u = viewportUniforms(V);
    const [scale, offset] = u.trackToClip;
    const first = 0 * scale + offset;
    const last = (V.trackCount - 1) * scale + offset;
    assert.ok(first > last, "track 0 must be above the last track in clip space");
    assert.ok(first < 1 && first > 0.5);
    assert.ok(last > -1 && last < -0.5);
  });

  it("pxSize is 2/resolution per axis", () => {
    const u = viewportUniforms(V);
    assert.deepEqual(u.pxSize, [2 / 800, 2 / 400]);
  });

  it("timeToPixelX is linear over the domain and matches the canvas width at the edges", () => {
    assert.equal(timeToPixelX(V, 0), 0);
    assert.equal(timeToPixelX(V, 10), 800);
    assert.equal(timeToPixelX(V, 5), 400);
  });

  it("trackToPixelY centers each row, and trackRowHeight divides the canvas evenly", () => {
    const rowHeight = trackRowHeight(V);
    assert.equal(rowHeight, 100);
    assert.equal(trackToPixelY(V, 0), 50);
    assert.equal(trackToPixelY(V, 3), 350);
  });

  it("pixelXToTime is the inverse of timeToPixelX", () => {
    for (const t of [0, 2.5, 5, 7.3, 10]) {
      assert.ok(Math.abs(pixelXToTime(V, timeToPixelX(V, t)) - t) < 1e-9);
    }
    assert.equal(pixelXToTime(V, 0), 0);
    assert.equal(pixelXToTime(V, 800), 10);
  });

  it("pixelYToTrack is the inverse of trackToPixelY", () => {
    for (const track of [0, 1, 2, 3]) {
      assert.ok(Math.abs(pixelYToTrack(V, trackToPixelY(V, track)) - track) < 1e-9);
    }
  });
});
