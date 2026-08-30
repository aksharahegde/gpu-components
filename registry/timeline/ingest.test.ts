import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { INSTANCE_STRIDE, computeDomainMax, computeOrigin, ingestSpans, ingestSpansChecked, packInstances } from "./ingest.ts";

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

describe("ingestSpansChecked — untrusted data validation (PLAN.md §24.2)", () => {
  it("drops non-finite starts and durations, and counts them", () => {
    const { spans, dropped } = ingestSpansChecked([
      { start: 0, duration: 1, track: 0 },
      { start: Number.NaN, duration: 1, track: 0 },
      { start: 5, duration: Number.POSITIVE_INFINITY, track: 0 },
    ]);
    assert.equal(spans.count, 1);
    assert.equal(dropped.nonFinite, 2);
  });

  it("prevents the blank-canvas failure a single NaN used to cause", () => {
    // Unchecked, a NaN start made computeOrigin return Infinity (its `s < origin` test is false for
    // NaN), so every start - origin became NaN, the NaN reached the viewport uniform, and the whole
    // canvas went blank — the exact outcome §24.2 warns about.
    const hostile = [
      { start: Number.NaN, duration: 1, track: 0 },
      { start: 10, duration: 2, track: 0 },
    ];
    assert.ok(Number.isFinite(computeOrigin(ingestSpansChecked(hostile).spans)));
    // And the unchecked path no longer propagates Infinity either.
    assert.ok(Number.isFinite(computeOrigin(ingestSpans(hostile))));
  });

  it("drops negative durations rather than drawing an inverted quad", () => {
    const { spans, dropped } = ingestSpansChecked([
      { start: 0, duration: -5, track: 0 },
      { start: 0, duration: 5, track: 0 },
    ]);
    assert.equal(spans.count, 1);
    assert.equal(dropped.negativeDuration, 1);
  });

  it("drops a track index that would silently wrap through Uint16Array", () => {
    const { spans, dropped } = ingestSpansChecked([
      { start: 0, duration: 1, track: 70000 },
      { start: 0, duration: 1, track: -1 },
      { start: 0, duration: 1, track: 1.5 },
      { start: 0, duration: 1, track: 3 },
    ]);
    assert.equal(spans.count, 1);
    assert.equal(dropped.badTrack, 3);
    assert.equal(spans.track[0], 3);
  });

  it("enforces track < trackCount when a count is supplied", () => {
    const { spans, dropped } = ingestSpansChecked(
      [
        { start: 0, duration: 1, track: 2 },
        { start: 0, duration: 1, track: 9 },
      ],
      4,
    );
    assert.equal(spans.count, 1);
    assert.equal(dropped.badTrack, 1);
  });

  it("reports nothing dropped for clean data", () => {
    const { spans, dropped } = ingestSpansChecked([{ start: 0, duration: 1, track: 0 }], 1);
    assert.equal(spans.count, 1);
    assert.deepEqual(dropped, { nonFinite: 0, negativeDuration: 0, badTrack: 0 });
  });
});
