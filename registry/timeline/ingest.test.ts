import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDomainMax, computeOrigin, INSTANCE_STRIDE, ingestSpans, packInstances } from "./ingest.ts";

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
    // Float64Array, not Float32Array (spikes/gpu-time-precision.md): the CPU-side source of truth
    // must not narrow an absolute (possibly epoch-scale) timestamp before hit-testing/labels read it.
    assert.ok(spans.start instanceof Float64Array);
    assert.ok(spans.duration instanceof Float64Array);
    assert.ok(spans.track instanceof Uint16Array);
    assert.ok(spans.colorIndex instanceof Uint8Array);
    assert.equal(spans.start.length, 1);
  });
});

describe("computeOrigin", () => {
  it("returns the minimum start across all tracks, not spans.start[0]", () => {
    // Sorted by (track, start): track 0 starts at 5, but track 1 starts earlier, at 2.
    const spans = ingestSpans([
      { start: 5, duration: 1, track: 0 },
      { start: 2, duration: 1, track: 1 },
    ]);
    assert.equal(computeOrigin(spans), 2);
  });

  it("is 0 for an empty dataset", () => {
    assert.equal(computeOrigin(ingestSpans([])), 0);
  });
});

describe("computeDomainMax", () => {
  it("returns the maximum (start + duration) across all tracks, not the last span in sort order", () => {
    // Sorted by (track, start): track 1's span ends latest (2 + 10 = 12), but it isn't last overall.
    const spans = ingestSpans([
      { start: 5, duration: 1, track: 0 },
      { start: 2, duration: 10, track: 1 },
    ]);
    assert.equal(computeDomainMax(spans), 12);
  });

  it("is 0 for an empty dataset", () => {
    assert.equal(computeDomainMax(ingestSpans([])), 0);
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

  it("subtracts the given origin before narrowing to f32 (spikes/gpu-time-precision.md)", () => {
    // An epoch-scale absolute start: narrowing this directly to f32 would lose whole seconds
    // (spikes/gpu-time-precision.md, Scenario A). Rebased to a nearby origin, the residual is exact.
    const origin = 1_772_400_000;
    const spans = ingestSpans([{ start: origin + 0.25, duration: 1, track: 0 }]);
    const bytes = packInstances(spans, origin);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getFloat32(0, true), 0.25);
  });
});
