import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LINE_FLAG_CLIP_X, LINE_FLAG_CLIP_Y } from "@gpuc/core";
import type { ViewportState } from "@gpuc/core";
import { computeAxisRules, MAX_AXIS_RULES, niceTickStep, timeRuleTicks } from "./axisRules.ts";

const viewport = (over: Partial<ViewportState> = {}): ViewportState => ({
  timeStart: 0,
  timeEnd: 100,
  trackCount: 4,
  width: 800,
  height: 400,
  ...over,
});

describe("niceTickStep", () => {
  it("rounds to 1, 2 or 5 times a power of ten", () => {
    for (const span of [1, 3, 7, 100, 250, 999, 1e6, 0.004]) {
      const step = niceTickStep(span);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      assert.ok(
        [1, 2, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-9),
        `step ${step} for span ${span} has mantissa ${mantissa}`,
      );
    }
  });

  it("lands near the requested tick count", () => {
    const step = niceTickStep(100, 10);
    assert.ok(100 / step >= 5 && 100 / step <= 20, `100/${step} should be roughly 10 ticks`);
  });

  it("returns a finite step for degenerate spans rather than 0, Infinity or NaN", () => {
    // A zero or negative span reaches here whenever a controlled `domain` prop collapses; a step of
    // 0 would make timeRuleTicks loop forever, which is the failure this guards.
    for (const span of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const step = niceTickStep(span);
      assert.ok(Number.isFinite(step) && step > 0, `span ${span} produced step ${step}`);
    }
  });
});

describe("timeRuleTicks", () => {
  it("emits ticks on step multiples inside the visible domain", () => {
    const ticks = timeRuleTicks(viewport({ timeStart: 0, timeEnd: 100 }));
    assert.ok(ticks.length > 0);
    const step = niceTickStep(100);
    for (const t of ticks) {
      assert.ok(t >= 0 && t <= 100, `${t} outside the domain`);
      assert.ok(Math.abs(t / step - Math.round(t / step)) < 1e-9, `${t} not on a ${step} step`);
    }
  });

  it("does not emit ticks before the domain start when the domain is offset", () => {
    const ticks = timeRuleTicks(viewport({ timeStart: 37, timeEnd: 137 }));
    assert.ok(ticks.every((t) => t >= 37));
  });

  it("returns nothing for a collapsed or inverted domain", () => {
    assert.deepEqual(timeRuleTicks(viewport({ timeStart: 5, timeEnd: 5 })), []);
    assert.deepEqual(timeRuleTicks(viewport({ timeStart: 10, timeEnd: 1 })), []);
  });
});

describe("computeAxisRules", () => {
  it("emits full-height time rules in the time domain and full-width track rules in the row domain", () => {
    const rules = computeAxisRules(viewport({ trackCount: 3 }));

    const timeRules = rules.filter((r) => r.flags === LINE_FLAG_CLIP_Y);
    const trackRules = rules.filter((r) => r.flags === LINE_FLAG_CLIP_X);
    assert.ok(timeRules.length > 0);

    for (const r of timeRules) {
      assert.equal(r.x0, r.x1, "a time rule is vertical");
      assert.deepEqual([r.y0, r.y1], [-1, 1], "and spans the full surface in clip space");
    }
    // 3 tracks -> 2 interior boundaries, at row 0/1 and row 1/2.
    assert.equal(trackRules.length, 2);
    assert.deepEqual(
      trackRules.map((r) => r.y0),
      [0.5, 1.5],
    );
    for (const r of trackRules) {
      assert.equal(r.y0, r.y1, "a track rule is horizontal");
      assert.deepEqual([r.x0, r.x1], [-1, 1]);
    }
  });

  it("makes rule x coordinates origin-relative, matching the packed spans", () => {
    const origin = 1_700_000_000_000;
    const v = viewport({ timeStart: origin, timeEnd: origin + 100 });
    const rules = computeAxisRules(v, origin).filter((r) => r.flags === LINE_FLAG_CLIP_Y);

    assert.ok(rules.length > 0);
    for (const r of rules) {
      // Without the origin subtraction these would be epoch-scale and lose all precision as f32 —
      // the exact bug spikes/gpu-time-precision.md measured.
      assert.ok(r.x0 >= 0 && r.x0 <= 100, `${r.x0} should be origin-relative`);
    }
  });

  it("drops track separators when rows are too thin to separate", () => {
    const rules = computeAxisRules(viewport({ trackCount: 200, height: 400 })); // 2px rows
    assert.equal(rules.filter((r) => r.flags === LINE_FLAG_CLIP_X).length, 0);
  });

  it("emits no track separators for a single track — there is no interior boundary", () => {
    const rules = computeAxisRules(viewport({ trackCount: 1 }));
    assert.equal(rules.filter((r) => r.flags === LINE_FLAG_CLIP_X).length, 0);
  });

  it("stays under the rule ceiling for a hostile track count", () => {
    const rules = computeAxisRules(viewport({ trackCount: 1e6, height: 1e7 }));
    assert.ok(rules.length <= MAX_AXIS_RULES, `${rules.length} rules exceeds the cap`);
  });

  it("returns finite coordinates for every rule", () => {
    const rules = computeAxisRules(viewport({ timeStart: -50, timeEnd: 50, trackCount: 8 }));
    for (const r of rules) {
      for (const n of [r.x0, r.y0, r.x1, r.y1, r.widthPx]) {
        assert.ok(Number.isFinite(n), `non-finite coordinate ${n}`);
      }
    }
  });
});
