import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestField } from "./ingest.ts";
import {
  createScene,
  pointInEllipse,
  pointInPolygon,
  pointInRect,
  distanceToSegment,
} from "./scene.ts";

const field = () =>
  ingestField({ width: 100, height: 100, values: new Float32Array(10_000) });

describe("geometry helpers", () => {
  it("pointInRect, pointInEllipse, distanceToSegment, pointInPolygon", () => {
    assert.equal(pointInRect(5, 5, 0, 0, 10, 10), true);
    assert.equal(pointInRect(15, 5, 0, 0, 10, 10), false);
    assert.equal(pointInEllipse(5, 5, 0, 0, 10, 10), true);
    assert.equal(pointInEllipse(11, 5, 0, 0, 10, 10), false);
    assert.equal(distanceToSegment(0, 5, 0, 0, 10, 0), 5);
    assert.equal(
      pointInPolygon(5, 5, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
      true,
    );
  });
});

describe("scene hitTest", () => {
  it("returns topmost annotation (later wins)", () => {
    const scene = createScene(field(), [
      { id: "a", kind: "rect", x: 10, y: 10, w: 30, h: 30 },
      { id: "b", kind: "rect", x: 15, y: 15, w: 30, h: 30 },
    ]);
    assert.equal(scene.hitTest(20, 20), "b");
  });

  it("returns null on miss", () => {
    const scene = createScene(field(), [
      { id: "a", kind: "rect", x: 10, y: 10, w: 20, h: 20 },
    ]);
    assert.equal(scene.hitTest(0, 0), null);
  });

  it("polygon contains point", () => {
    const scene = createScene(field(), [
      {
        id: "poly",
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
      },
    ]);
    assert.equal(scene.hitTest(10, 10), "poly");
    assert.equal(scene.hitTest(50, 50), null);
  });

  it("setAnnotations replaces the hit-test set", () => {
    const scene = createScene(field(), [
      { id: "a", kind: "rect", x: 0, y: 0, w: 10, h: 10 },
    ]);
    assert.equal(scene.hitTest(5, 5), "a");
    scene.setAnnotations([{ id: "b", kind: "rect", x: 50, y: 50, w: 10, h: 10 }]);
    assert.equal(scene.hitTest(5, 5), null);
    assert.equal(scene.hitTest(55, 55), "b");
  });
});
