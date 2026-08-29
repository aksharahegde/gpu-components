import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestSpans } from "./ingest.ts";
import { hitTestSpans } from "./hitTest.ts";

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
