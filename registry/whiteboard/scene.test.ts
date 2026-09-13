import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boundsIntersect, createScene, shapeBounds } from "./scene.ts";
import type { WhiteboardShape } from "./ingest.ts";

const RECT: WhiteboardShape = { id: "rect-1", kind: "rect", x: 1, y: 1, w: 3, h: 3 };
const ELLIPSE: WhiteboardShape = { id: "ellipse-1", kind: "ellipse", x: 10, y: 10, w: 4, h: 2 };
const RULER: WhiteboardShape = { id: "ruler-1", kind: "ruler", x0: 0, y0: 0, x1: 4, y1: 0 };
const POLYGON: WhiteboardShape = {
  id: "poly-1",
  kind: "polygon",
  points: [{ x: 20, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 4 }, { x: 20, y: 4 }],
};
const FREEHAND: WhiteboardShape = {
  id: "free-1",
  kind: "freehand",
  points: [{ x: 30, y: 0 }, { x: 32, y: 1 }, { x: 33, y: 3 }],
};
const POINT: WhiteboardShape = { id: "point-1", kind: "point", x: 40, y: 40 };

describe("whiteboard scene", () => {
  it("hit-tests a rect by containment, not just its border", () => {
    const scene = createScene([RECT]);
    assert.equal(scene.hitTest(2.5, 2.5), "rect-1");
    assert.equal(scene.hitTest(100, 100), null);
  });

  it("hit-tests an ellipse inscribed in its bounding box", () => {
    const scene = createScene([ELLIPSE]);
    assert.equal(scene.hitTest(12, 11), "ellipse-1"); // center
    assert.equal(scene.hitTest(10, 10), null); // bbox corner, outside the inscribed ellipse
  });

  it("hit-tests a ruler within tolerance of the segment", () => {
    const scene = createScene([RULER]);
    assert.equal(scene.hitTest(2, 0), "ruler-1");
    assert.equal(scene.hitTest(2, 5), null);
  });

  it("hit-tests a polygon by containment and by edge proximity", () => {
    const scene = createScene([POLYGON]);
    assert.equal(scene.hitTest(22, 2), "poly-1"); // interior
    assert.equal(scene.hitTest(22, 0), "poly-1"); // on an edge
    assert.equal(scene.hitTest(50, 50), null);
  });

  it("hit-tests a freehand path by segment proximity", () => {
    const scene = createScene([FREEHAND]);
    assert.equal(scene.hitTest(32, 1), "free-1");
    assert.equal(scene.hitTest(60, 60), null);
  });

  it("hit-tests a point within its tolerance radius", () => {
    const scene = createScene([POINT]);
    assert.equal(scene.hitTest(40, 40), "point-1");
    assert.equal(scene.hitTest(40.1, 40.1), "point-1"); // within DEFAULT_HIT_TOLERANCE (0.15)
    assert.equal(scene.hitTest(41, 41), null); // well outside it
  });

  it("prefers the topmost (last) shape on overlap", () => {
    const scene = createScene([RECT, { id: "rect-2", kind: "rect", x: 1, y: 1, w: 3, h: 3 }]);
    assert.equal(scene.hitTest(2.5, 2.5), "rect-2");
  });

  it("setShapes replaces the retained set for subsequent hit-tests", () => {
    const scene = createScene([RECT]);
    assert.equal(scene.hitTest(2.5, 2.5), "rect-1");
    scene.setShapes([]);
    assert.equal(scene.hitTest(2.5, 2.5), null);
  });
});

describe("shapeBounds", () => {
  it("computes a rect/ellipse's own x/y/w/h box", () => {
    assert.deepEqual(shapeBounds(RECT), { xMin: 1, yMin: 1, xMax: 4, yMax: 4 });
    assert.deepEqual(shapeBounds(ELLIPSE), { xMin: 10, yMin: 10, xMax: 14, yMax: 12 });
  });

  it("collapses a point to a zero-size box at its position", () => {
    assert.deepEqual(shapeBounds(POINT), { xMin: 40, yMin: 40, xMax: 40, yMax: 40 });
  });

  it("normalizes a ruler's endpoints regardless of direction", () => {
    const reversed: WhiteboardShape = { id: "ru", kind: "ruler", x0: 4, y0: 0, x1: 0, y1: 0 };
    assert.deepEqual(shapeBounds(reversed), { xMin: 0, yMin: 0, xMax: 4, yMax: 0 });
  });

  it("bounds a polygon/freehand to the extent of its points", () => {
    assert.deepEqual(shapeBounds(POLYGON), { xMin: 20, yMin: 0, xMax: 24, yMax: 4 });
    assert.deepEqual(shapeBounds(FREEHAND), { xMin: 30, yMin: 0, xMax: 33, yMax: 3 });
  });
});

describe("boundsIntersect", () => {
  it("is true for overlapping boxes, including touching edges", () => {
    assert.ok(boundsIntersect({ xMin: 0, yMin: 0, xMax: 4, yMax: 4 }, { xMin: 2, yMin: 2, xMax: 6, yMax: 6 }));
    assert.ok(boundsIntersect({ xMin: 0, yMin: 0, xMax: 4, yMax: 4 }, { xMin: 4, yMin: 4, xMax: 8, yMax: 8 }));
  });

  it("is false for disjoint boxes", () => {
    assert.equal(
      boundsIntersect({ xMin: 0, yMin: 0, xMax: 4, yMax: 4 }, { xMin: 5, yMin: 5, xMax: 8, yMax: 8 }),
      false,
    );
  });
});
