import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestField, MAX_FIELD_DIM } from "./ingest.ts";
import { areaEllipse, areaPolygon, areaRect, lengthOf } from "./measure.ts";

describe("ingestField", () => {
  it("wraps values and defaults window to finite min/max", () => {
    const values = new Float32Array([1, 2, 3, 4]);
    const f = ingestField({ width: 2, height: 2, values });
    assert.equal(f.width, 2);
    assert.equal(f.window.min, 1);
    assert.equal(f.window.max, 4);
  });

  it("rejects size/length mismatch and non-positive dims", () => {
    assert.throws(() => ingestField({ width: 2, height: 2, values: new Float32Array(3) }), /expected 4/);
    assert.throws(() => ingestField({ width: 0, height: 1, values: new Float32Array(0) }), /positive/);
  });

  it("rejects width or height beyond MAX_FIELD_DIM", () => {
    assert.throws(
      () => ingestField({ width: MAX_FIELD_DIM + 1, height: 1, values: new Float32Array(MAX_FIELD_DIM + 1) }),
      /MAX_FIELD_DIM/,
    );
    assert.throws(
      () => ingestField({ width: 1, height: MAX_FIELD_DIM + 1, values: new Float32Array(MAX_FIELD_DIM + 1) }),
      /MAX_FIELD_DIM/,
    );
  });

  it("honours explicit window", () => {
    const f = ingestField({
      width: 2,
      height: 1,
      values: new Float32Array([0, 10]),
      window: { min: 2, max: 8 },
    });
    assert.deepEqual(f.window, { min: 2, max: 8 });
  });
});

describe("measure", () => {
  it("computes length and areas", () => {
    assert.equal(lengthOf(0, 0, 3, 4), 5);
    assert.equal(areaRect(3, 4), 12);
    assert.ok(Math.abs(areaEllipse(2, 2) - Math.PI) < 1e-6);
    assert.equal(areaPolygon([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]), 4);
  });
});
