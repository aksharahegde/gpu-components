import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestSpans } from "./ingest.ts";
import {
  firstSpanIndex,
  hitTestSpans,
  lastSpanIndex,
  nearestSpanOnTrack,
  nextSpanInTrack,
  prevSpanInTrack,
  selectSpansInRange,
} from "./hitTest.ts";

describe("hitTestSpans", () => {
  it("hits a span at its exact start", () => {
    const spans = ingestSpans([{ start: 5, duration: 2, track: 0 }]);
    assert.equal(hitTestSpans(spans, 0, 5), 0);
  });

  it("hits a span strictly inside its bounds", () => {
    const spans = ingestSpans([{ start: 5, duration: 2, track: 0 }]);
    assert.equal(hitTestSpans(spans, 0, 6), 0);
  });

  it("treats the end as exclusive", () => {
    const spans = ingestSpans([{ start: 5, duration: 2, track: 0 }]);
    assert.equal(hitTestSpans(spans, 0, 7), null);
  });

  it("misses before a span's start", () => {
    const spans = ingestSpans([{ start: 5, duration: 2, track: 0 }]);
    assert.equal(hitTestSpans(spans, 0, 4.999), null);
  });

  it("returns null for a track with no spans", () => {
    const spans = ingestSpans([{ start: 0, duration: 1, track: 0 }]);
    assert.equal(hitTestSpans(spans, 5, 0), null);
  });

  it("returns null for time outside every span, between two spans on the same track", () => {
    const spans = ingestSpans([
      { start: 0, duration: 1, track: 0 },
      { start: 5, duration: 1, track: 0 },
    ]);
    assert.equal(hitTestSpans(spans, 0, 2.5), null);
  });

  it("disambiguates across interleaved tracks correctly", () => {
    const spans = ingestSpans([
      { start: 10, duration: 1, track: 1, label: "t1-a" },
      { start: 0, duration: 1, track: 0, label: "t0-a" },
      { start: 20, duration: 1, track: 1, label: "t1-b" },
      { start: 5, duration: 1, track: 0, label: "t0-b" },
    ]);
    const t0Hit = hitTestSpans(spans, 0, 5.5);
    const t1Hit = hitTestSpans(spans, 1, 20.5);
    assert.equal(spans.labels[t0Hit!], "t0-b");
    assert.equal(spans.labels[t1Hit!], "t1-b");
    // Same time value, wrong track: no match.
    assert.equal(hitTestSpans(spans, 1, 5.5), null);
  });

  it("finds the covering span among adjacent overlapping spans on the same track", () => {
    const spans = ingestSpans([
      { start: 0, duration: 10, track: 0, label: "outer" },
      { start: 2, duration: 2, track: 0, label: "inner" },
    ]);
    assert.equal(spans.labels[hitTestSpans(spans, 0, 3)!], "inner");
    assert.equal(spans.labels[hitTestSpans(spans, 0, 7)!], "outer");
  });
});

describe("keyboard-navigation traversal (hitTest.ts)", () => {
  const spans = ingestSpans([
    { start: 10, duration: 1, track: 1, label: "t1-b" },
    { start: 0, duration: 1, track: 0, label: "t0-a" },
    { start: 20, duration: 1, track: 1, label: "t1-c" },
    { start: 5, duration: 1, track: 0, label: "t0-b" },
    { start: 0, duration: 1, track: 1, label: "t1-a" },
  ]);
  // Sorted (track, start): t0-a@0, t0-b@5, t1-a@0, t1-b@10, t1-c@20 → indices 0..4

  describe("nextSpanInTrack / prevSpanInTrack", () => {
    it("steps forward within a track", () => {
      const first = spans.track.indexOf(0); // t0-a
      const next = nextSpanInTrack(spans, 0, first);
      assert.equal(spans.labels[next!], "t0-b");
    });

    it("returns null past the track's last span", () => {
      const last = spans.labels.indexOf("t0-b");
      assert.equal(nextSpanInTrack(spans, 0, last), null);
    });

    it("steps backward within a track", () => {
      const last = spans.labels.indexOf("t0-b");
      const prev = prevSpanInTrack(spans, 0, last);
      assert.equal(spans.labels[prev!], "t0-a");
    });

    it("returns null before the track's first span", () => {
      const first = spans.labels.indexOf("t0-a");
      assert.equal(prevSpanInTrack(spans, 0, first), null);
    });

    it("does not cross into an adjacent track", () => {
      const lastOfTrack0 = spans.labels.indexOf("t0-b");
      // lastOfTrack0 + 1 lands on track 1's first span in storage order — must not be returned.
      assert.equal(nextSpanInTrack(spans, 0, lastOfTrack0), null);
    });
  });

  describe("nearestSpanOnTrack", () => {
    it("finds the closest span on the target track by time", () => {
      // Moving from t0-b (start=5) to track 1: candidates are t1-a@0 (dist 5) and t1-b@10 (dist 5) — tie goes to `before`.
      const nearest = nearestSpanOnTrack(spans, 1, 5);
      assert.equal(spans.labels[nearest!], "t1-a");
    });

    it("picks the strictly closer candidate when not tied", () => {
      const nearest = nearestSpanOnTrack(spans, 1, 8);
      assert.equal(spans.labels[nearest!], "t1-b");
    });

    it("returns null for a track with no spans", () => {
      assert.equal(nearestSpanOnTrack(spans, 5, 0), null);
    });

    it("clamps to the track's first span when time is before everything", () => {
      const nearest = nearestSpanOnTrack(spans, 1, -100);
      assert.equal(spans.labels[nearest!], "t1-a");
    });

    it("clamps to the track's last span when time is after everything", () => {
      const nearest = nearestSpanOnTrack(spans, 1, 100);
      assert.equal(spans.labels[nearest!], "t1-c");
    });
  });

  describe("firstSpanIndex / lastSpanIndex", () => {
    it("returns the dataset's first and last span in storage order", () => {
      assert.equal(spans.labels[firstSpanIndex(spans)!], "t0-a");
      assert.equal(spans.labels[lastSpanIndex(spans)!], "t1-c");
    });

    it("returns null for an empty dataset", () => {
      const empty = ingestSpans([]);
      assert.equal(firstSpanIndex(empty), null);
      assert.equal(lastSpanIndex(empty), null);
    });
  });

  describe("selectSpansInRange", () => {
    it("selects spans overlapping the time range on tracks within range", () => {
      const ids = selectSpansInRange(spans, 0, 0, 0, 5);
      assert.deepEqual(
        ids.map((i) => spans.labels[i]).sort(),
        ["t0-a", "t0-b"],
      );
    });

    it("excludes a span entirely outside the time range", () => {
      const ids = selectSpansInRange(spans, 0, 0, 100, 200);
      assert.deepEqual(ids, []);
    });

    it("excludes tracks outside the track range", () => {
      const ids = selectSpansInRange(spans, 0, 0, 0, 1000);
      assert.ok(!ids.some((i) => spans.labels[i] === "t1-c"));
    });

    it("spans a multi-track range", () => {
      const ids = selectSpansInRange(spans, 0, 1, 0, 1000);
      assert.deepEqual(
        ids.map((i) => spans.labels[i]).sort(),
        ["t0-a", "t0-b", "t1-a", "t1-b", "t1-c"].sort(),
      );
    });

    it("normalizes a reversed track range the same as a forward one", () => {
      const forward = selectSpansInRange(spans, 0, 1, 0, 1000);
      const reversed = selectSpansInRange(spans, 1, 0, 0, 1000);
      assert.deepEqual(reversed, forward);
    });
  });
});
