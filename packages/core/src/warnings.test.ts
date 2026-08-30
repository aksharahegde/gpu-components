import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWarningsLog } from "./warnings.ts";

describe("createWarningsLog", () => {
  it("dedupes by (code, source): a repeat bumps count instead of adding a new row", () => {
    const log = createWarningsLog();
    log.report({ code: "buffer-growth", source: "timeline-0", message: "grew 4 -> 8" });
    log.report({ code: "buffer-growth", source: "timeline-0", message: "grew 8 -> 16" });

    assert.equal(log.recent.length, 1);
    assert.equal(log.recent[0]!.count, 2);
    assert.equal(log.recent[0]!.message, "grew 8 -> 16", "the latest message should win");
  });

  it("tracks distinct (code, source) pairs as separate entries", () => {
    const log = createWarningsLog();
    log.report({ code: "buffer-growth", source: "a", message: "m" });
    log.report({ code: "buffer-growth", source: "b", message: "m" });
    log.report({ code: "redundant-uniform-write", source: "a", message: "m" });

    assert.equal(log.recent.length, 3);
  });

  it("recent orders most-recently-updated first", () => {
    const log = createWarningsLog();
    log.report({ code: "x", source: "a", message: "1" });
    log.report({ code: "x", source: "b", message: "2" });
    log.report({ code: "x", source: "a", message: "3" }); // bump a back to the front

    assert.deepEqual(
      log.recent.map((w) => w.source),
      ["a", "b"],
    );
  });

  it("evicts the least-recently-updated entry once maxEntries is exceeded", () => {
    const log = createWarningsLog(2);
    log.report({ code: "x", source: "a", message: "1" });
    log.report({ code: "x", source: "b", message: "2" });
    log.report({ code: "x", source: "c", message: "3" }); // should evict "a"

    assert.deepEqual(
      log.recent.map((w) => w.source),
      ["c", "b"],
    );
  });

  it("a hot repeat offender is never evicted by its own repetition", () => {
    const log = createWarningsLog(1);
    for (let i = 0; i < 10; i++) log.report({ code: "x", source: "a", message: String(i) });

    assert.equal(log.recent.length, 1);
    assert.equal(log.recent[0]!.count, 10);
  });

  it("onWarning fires once per report(), after dedup, with the bumped count", () => {
    const log = createWarningsLog();
    const seen: number[] = [];
    const unsub = log.onWarning((w) => seen.push(w.count));

    log.report({ code: "x", source: "a", message: "1" });
    log.report({ code: "x", source: "a", message: "2" });
    assert.deepEqual(seen, [1, 2]);

    unsub();
    log.report({ code: "x", source: "a", message: "3" });
    assert.deepEqual(seen, [1, 2], "no further calls after unsubscribe");
  });

  it("dispose() clears entries and listeners", () => {
    const log = createWarningsLog();
    log.report({ code: "x", source: "a", message: "1" });
    log.dispose();
    assert.equal(log.recent.length, 0);
  });
});
