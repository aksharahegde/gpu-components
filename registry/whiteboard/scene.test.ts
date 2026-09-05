import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createScene } from "./scene.ts";
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
