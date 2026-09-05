import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestWhiteboard, MAX_COORDINATE, type WhiteboardShape } from "./ingest.ts";

describe("ingestWhiteboard", () => {
  it("computes a padded bounding box over every shape kind", () => {
    const shapes: WhiteboardShape[] = [
      { id: "r", kind: "rect", x: 0, y: 0, w: 4, h: 2 },
      { id: "l", kind: "ruler", x0: -2, y0: 5, x1: 3, y1: 5 },
      { id: "p", kind: "polygon", points: [{ x: -4, y: -4 }, { x: 6, y: -4 }, { x: 6, y: 6 }] },
    ];
    const data = ingestWhiteboard(shapes);
    assert.ok(data.bounds.xMin < -4);
    assert.ok(data.bounds.xMax > 6);
    assert.ok(data.bounds.yMin < -4);
    assert.ok(data.bounds.yMax > 6);
    assert.equal(data.shapes, shapes);
  });

  it("gives an empty board a small default box around the origin, not an error", () => {
    const data = ingestWhiteboard([]);
    assert.ok(data.bounds.xMin < 0 && data.bounds.xMax > 0);
    assert.ok(data.bounds.yMin < 0 && data.bounds.yMax > 0);
  });

  it("rejects a coordinate outside ±MAX_COORDINATE", () => {
    assert.throws(
      () => ingestWhiteboard([{ id: "far", kind: "point", x: MAX_COORDINATE + 1, y: 0 }]),
      /outside/,
    );
  });

  it("rejects a non-finite coordinate", () => {
    assert.throws(
      () => ingestWhiteboard([{ id: "nan", kind: "point", x: Number.NaN, y: 0 }]),
      /outside/,
    );
  });
});
