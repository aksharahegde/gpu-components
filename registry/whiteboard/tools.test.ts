import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createShapeId,
  createToolController,
  MAX_POLYGON_POINTS,
  moveShape,
  rectFromDrag,
  simplifyPoints,
} from "./tools.ts";

describe("rectFromDrag", () => {
  it("normalizes any drag direction to positive w/h", () => {
    assert.deepEqual(rectFromDrag(0, 0, 10, 6), { x: 0, y: 0, w: 10, h: 6 });
    assert.deepEqual(rectFromDrag(10, 6, 0, 0), { x: 0, y: 0, w: 10, h: 6 });
    assert.deepEqual(rectFromDrag(10, 0, 0, 6), { x: 0, y: 0, w: 10, h: 6 });
    assert.deepEqual(rectFromDrag(0, 6, 10, 0), { x: 0, y: 0, w: 10, h: 6 });
  });
});

describe("createShapeId", () => {
  it("returns unique, non-empty ids", () => {
    const a = createShapeId();
    const b = createShapeId();
    assert.notEqual(a, b);
    assert.ok(a.length > 0);
    assert.ok(b.length > 0);
  });
});

describe("createToolController — rect", () => {
  it("a drag produces a rect shape with positive w/h, regardless of drag direction", () => {
    const controller = createToolController("rect");
    controller.onPointerDown({ x: 10, y: 10 });
    controller.onPointerMove({ x: 2, y: 4 });
    assert.ok(controller.draft, "a draft should preview mid-drag");
    assert.equal(controller.draft?.kind, "rect");

    const result = controller.onPointerUp({ x: 2, y: 4 });
    assert.ok(result);
    assert.equal(result!.kind, "rect");
    if (result!.kind === "rect") {
      assert.equal(result!.x, 2);
      assert.equal(result!.y, 4);
      assert.equal(result!.w, 8);
      assert.equal(result!.h, 6);
    }
    assert.equal(controller.draft, null, "draft clears once the gesture finalizes");
  });

  it("a plain click (no movement) does not create a degenerate rect", () => {
    const controller = createToolController("rect");
    controller.onPointerDown({ x: 5, y: 5 });
    const result = controller.onPointerUp({ x: 5, y: 5 });
    assert.equal(result, null);
  });
});

describe("createToolController — ellipse", () => {
  it("a drag produces an ellipse shape with positive w/h", () => {
    const controller = createToolController("ellipse");
    controller.onPointerDown({ x: 0, y: 0 });
    controller.onPointerMove({ x: 4, y: 4 });
    const result = controller.onPointerUp({ x: 4, y: 4 });
    assert.ok(result && result.kind === "ellipse");
    if (result && result.kind === "ellipse") {
      assert.equal(result.w, 4);
      assert.equal(result.h, 4);
    }
  });
});

describe("createToolController — ruler", () => {
  it("a drag produces a ruler with the dragged endpoints", () => {
    const controller = createToolController("ruler");
    controller.onPointerDown({ x: 0, y: 0 });
    controller.onPointerMove({ x: 3, y: 4 });
    const result = controller.onPointerUp({ x: 3, y: 4 });
    assert.ok(result && result.kind === "ruler");
    if (result && result.kind === "ruler") {
      assert.deepEqual(result, { id: result.id, kind: "ruler", x0: 0, y0: 0, x1: 3, y1: 4 });
    }
  });

  it("a plain click does not create a zero-length ruler", () => {
    const controller = createToolController("ruler");
    controller.onPointerDown({ x: 1, y: 1 });
    const result = controller.onPointerUp({ x: 1, y: 1 });
    assert.equal(result, null);
  });
});

describe("createToolController — point", () => {
  it("a click places a point at the pointer position", () => {
    const controller = createToolController("point");
    controller.onPointerDown({ x: 7, y: 9 });
    const result = controller.onPointerUp({ x: 7, y: 9 });
    assert.ok(result && result.kind === "point");
    if (result && result.kind === "point") {
      assert.equal(result.x, 7);
      assert.equal(result.y, 9);
    }
  });
});

describe("createToolController — polygon", () => {
  it("click-to-add builds up vertices, and finish() closes the shape", () => {
    const controller = createToolController("polygon");
    assert.equal(controller.onPointerUp({ x: 0, y: 0 }), null, "still collecting");
    assert.equal(controller.onPointerUp({ x: 10, y: 0 }), null, "still collecting");
    assert.equal(controller.onPointerUp({ x: 10, y: 10 }), null, "still collecting");

    const result = controller.finish();
    assert.ok(result && result.kind === "polygon");
    if (result && result.kind === "polygon") {
      assert.deepEqual(result.points, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]);
    }
    assert.equal(controller.draft, null);
  });

  it("finish() with fewer than 3 vertices discards the draft", () => {
    const controller = createToolController("polygon");
    controller.onPointerUp({ x: 0, y: 0 });
    controller.onPointerUp({ x: 10, y: 0 });
    assert.equal(controller.finish(), null);
    assert.equal(controller.draft, null);
  });

  it("caps vertices at MAX_POLYGON_POINTS", () => {
    const controller = createToolController("polygon");
    for (let i = 0; i < MAX_POLYGON_POINTS + 10; i++) {
      controller.onPointerUp({ x: i, y: 0 });
    }
    const result = controller.finish();
    assert.ok(result && result.kind === "polygon");
    if (result && result.kind === "polygon") {
      assert.equal(result.points.length, MAX_POLYGON_POINTS);
    }
  });
});

describe("createToolController — freehand", () => {
  it("samples points on move while down, and emits a polyline on up", () => {
    const controller = createToolController("freehand");
    controller.onPointerDown({ x: 0, y: 0 });
    controller.onPointerMove({ x: 1, y: 1 });
    controller.onPointerMove({ x: 2, y: 2 });
    const result = controller.onPointerUp({ x: 3, y: 3 });
    assert.ok(result && result.kind === "freehand");
    if (result && result.kind === "freehand") {
      assert.equal(result.points.length, 4);
      assert.deepEqual(result.points[0], { x: 0, y: 0 });
      assert.deepEqual(result.points[3], { x: 3, y: 3 });
    }
  });

  it("a single-point freehand (click, no drag) produces no shape", () => {
    const controller = createToolController("freehand");
    controller.onPointerDown({ x: 5, y: 5 });
    const result = controller.onPointerUp({ x: 5, y: 5 });
    assert.equal(result, null);
  });
});

describe("createToolController — cancel", () => {
  it("discards any in-progress draft", () => {
    const controller = createToolController("rect");
    controller.onPointerDown({ x: 0, y: 0 });
    controller.onPointerMove({ x: 5, y: 5 });
    assert.ok(controller.draft);
    controller.cancel();
    assert.equal(controller.draft, null);
    assert.equal(controller.onPointerUp({ x: 5, y: 5 }), null, "the cancelled drag leaves no pending down");
  });
});

describe("moveShape", () => {
  it("translates every shape kind by (dx, dy)", () => {
    assert.deepEqual(
      moveShape({ id: "r", kind: "rect", x: 1, y: 2, w: 3, h: 4 }, 10, -5),
      { id: "r", kind: "rect", x: 11, y: -3, w: 3, h: 4 },
    );
    assert.deepEqual(
      moveShape({ id: "p", kind: "point", x: 1, y: 2 }, 1, 1),
      { id: "p", kind: "point", x: 2, y: 3 },
    );
    assert.deepEqual(
      moveShape({ id: "ru", kind: "ruler", x0: 0, y0: 0, x1: 4, y1: 0 }, 2, 3),
      { id: "ru", kind: "ruler", x0: 2, y0: 3, x1: 6, y1: 3 },
    );
    assert.deepEqual(
      moveShape({ id: "pg", kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 5, 5),
      { id: "pg", kind: "polygon", points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] },
    );
  });
});

describe("simplifyPoints", () => {
  it("passes through arrays at or under the cap", () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    assert.deepEqual(simplifyPoints(points, 5), points);
  });

  it("downsamples to exactly the cap, preserving the first and last point", () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: 0 }));
    const result = simplifyPoints(points, 10);
    assert.equal(result.length, 10);
    assert.deepEqual(result[0], { x: 0, y: 0 });
    assert.deepEqual(result[9], { x: 999, y: 0 });
  });
});
