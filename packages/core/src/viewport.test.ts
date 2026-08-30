import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pixelXToTime, pixelYToTrack, rowRange, timeToPixelX, trackRowHeight, trackToPixelY, viewportUniforms, visibleRows } from "./viewport.ts";

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

describe("vertical row range (PLAN.md §29 Phase 5 — the heatmap's second axis)", () => {
  const base = { timeStart: 0, timeEnd: 100, trackCount: 8, width: 200, height: 100 };

  it("reduces to the pre-existing mapping exactly when no row range is set", () => {
    // The generalisation must not move a single pixel for callers that predate it.
    const legacy = viewportUniforms(base);
    const explicit = viewportUniforms({ ...base, rowStart: 0, rowEnd: 8 });
    assert.deepEqual(legacy.trackToClip, explicit.trackToClip);
    assert.deepEqual(legacy.trackToClip, [-2 / 8, 1 - 1 / 8]);
  });

  it("maps the first and last visible rows to the top and bottom of the surface", () => {
    const v = { ...base, rowStart: 2, rowEnd: 6 };
    const [scale, offset] = viewportUniforms(v).trackToClip;
    // Row 2 is the first visible row: its centre sits half a row below the top edge.
    const clipTop = 2 * scale + offset;
    const clipBottom = 5 * scale + offset;
    assert.ok(clipTop > 0.6 && clipTop < 1, `first visible row near the top, got ${clipTop}`);
    assert.ok(clipBottom < -0.6 && clipBottom > -1, `last visible row near the bottom, got ${clipBottom}`);
  });

  it("keeps pixel helpers consistent with the clip mapping under a scrolled range", () => {
    const v = { ...base, rowStart: 2, rowEnd: 6 };
    assert.equal(trackRowHeight(v), 25, "4 visible rows over 100px");
    assert.equal(trackToPixelY(v, 2), 12.5, "first visible row's centre");
    // Round-trip: pixel -> row -> pixel.
    assert.ok(Math.abs(pixelYToTrack(v, trackToPixelY(v, 4)) - 4) < 1e-9);
  });

  it("visibleRows and rowRange default to the full track count", () => {
    assert.deepEqual(rowRange(base), [0, 8]);
    assert.equal(visibleRows(base), 8);
    assert.equal(visibleRows({ ...base, rowStart: 1, rowEnd: 4 }), 3);
  });
});
