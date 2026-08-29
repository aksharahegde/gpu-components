import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestSpans } from "./ingest.ts";
import { describeTimeline, visibleLabels } from "./viewModel.ts";

const VIEWPORT = { timeStart: 0, timeEnd: 10, trackCount: 2, width: 1000, height: 200 };

describe("visibleLabels", () => {
  it("skips spans with no label", () => {
    const spans = ingestSpans([{ start: 0, duration: 5, track: 0 }]);
    assert.equal(visibleLabels(spans, VIEWPORT).length, 0);
  });

  it("skips spans narrower than the minimum label width", () => {
    const spans = ingestSpans([{ start: 0, duration: 0.05, track: 0, label: "tiny" }]);
    assert.equal(visibleLabels(spans, VIEWPORT).length, 0);
  });

  it("skips spans entirely outside the visible time domain", () => {
    const spans = ingestSpans([{ start: 20, duration: 2, track: 0, label: "offscreen" }]);
    assert.equal(visibleLabels(spans, VIEWPORT).length, 0);
  });

  it("places a wide, in-view, labeled span at its pixel position", () => {
    const spans = ingestSpans([{ start: 0, duration: 5, track: 0, label: "wide" }]);
    const labels = visibleLabels(spans, VIEWPORT);
    assert.equal(labels.length, 1);
    assert.equal(labels[0]!.text, "wide");
    assert.equal(labels[0]!.x, 0);
    assert.equal(labels[0]!.width, 500);
  });

  it("caps at 400 labels", () => {
    const raw = Array.from({ length: 500 }, (_, i) => ({
      start: (i / 500) * 10,
      duration: 5,
      track: 0,
      label: `s${i}`,
    }));
    const labels = visibleLabels(ingestSpans(raw), VIEWPORT);
    assert.equal(labels.length, 400);
  });
});

describe("describeTimeline", () => {
  it("reports total span count and only the visible/labeled ones as children", () => {
    const spans = ingestSpans([
      { start: 0, duration: 5, track: 0, label: "visible" },
      { start: 0, duration: 5, track: 0 },
    ]);
    const model = describeTimeline(spans, VIEWPORT);
    assert.equal(model.role, "list");
    assert.match(model.label, /2 spans/);
    assert.equal(model.children?.length, 1);
    assert.equal(model.children?.[0]!.label, "visible");
  });
});
