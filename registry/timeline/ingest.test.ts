import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { INSTANCE_STRIDE, ingestSpans, packInstances } from "./ingest.ts";

describe("ingestSpans", () => {
  it("sorts by (track, start)", () => {
    const spans = ingestSpans([
      { start: 5, duration: 1, track: 1, label: "b-late" },
      { start: 1, duration: 1, track: 0, label: "a-early" },
      { start: 2, duration: 1, track: 1, label: "b-early" },
      { start: 0, duration: 1, track: 0, label: "a-earliest" },
    ]);

    assert.deepEqual(Array.from(spans.track), [0, 0, 1, 1]);
    assert.deepEqual(spans.labels, ["a-earliest", "a-early", "b-early", "b-late"]);
    assert.equal(spans.count, 4);
  });

  it("assigns a default colorIndex from the original (pre-sort) index when none is given", () => {
    const spans = ingestSpans([
      { start: 0, duration: 1, track: 0 },
      { start: 1, duration: 1, track: 0, colorIndex: 5 },
    ]);
    assert.equal(spans.colorIndex[0], 0);
    assert.equal(spans.colorIndex[1], 5);
  });

  it("produces columnar typed arrays of the right length and type", () => {
    const spans = ingestSpans([{ start: 0, duration: 1, track: 0 }]);
    assert.ok(spans.start instanceof Float32Array);
    assert.ok(spans.duration instanceof Float32Array);
    assert.ok(spans.track instanceof Uint16Array);
    assert.ok(spans.colorIndex instanceof Uint8Array);
    assert.equal(spans.start.length, 1);
  });
});

describe("packInstances", () => {
  it("packs each span into INSTANCE_STRIDE bytes, little-endian, matching timeline.wgsl's SpanInstance", () => {
    const spans = ingestSpans([{ start: 1.5, duration: 2.5, track: 3, colorIndex: 7 }]);
    const bytes = packInstances(spans);
    assert.equal(bytes.byteLength, INSTANCE_STRIDE);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getFloat32(0, true), 1.5);
    assert.equal(view.getFloat32(4, true), 2.5);
    assert.equal(view.getUint32(8, true), 3);
    assert.equal(view.getUint32(12, true), 7);
  });
});
