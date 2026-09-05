import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_RANGE_CELLS, parseCellRef, parseRange } from "./cellRef.ts";

describe("parseCellRef", () => {
  it("parses an ordinary ref", () => {
    assert.deepEqual(parseCellRef("A1"), { col: 0, row: 0 });
    assert.deepEqual(parseCellRef("ZZ99999"), { col: 701, row: 99998 });
  });

  it("rejects a ref past MAX_COLUMN_LETTERS", () => {
    assert.equal(parseCellRef("ZZZZZZ1"), null);
  });

  it("rejects a ref past MAX_ROW_DIGITS", () => {
    assert.equal(parseCellRef("A99999999"), null);
  });
});

describe("parseRange", () => {
  it("parses an ordinary range", () => {
    const r = parseRange("A1:B2");
    assert.deepEqual(r, { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } });
  });

  it("returns null just past MAX_RANGE_CELLS", () => {
    // 2 columns wide, so the row span alone tips it over the cap.
    const rows = Math.ceil(MAX_RANGE_CELLS / 2) + 1;
    assert.equal(parseRange(`A1:B${rows}`), null);
  });

  it("still works just under MAX_RANGE_CELLS", () => {
    const rows = Math.floor(MAX_RANGE_CELLS / 2);
    const r = parseRange(`A1:B${rows}`);
    assert.notEqual(r, null);
    assert.equal(r!.end.row, rows - 1);
  });

  it("returns null for a range built from an over-long ref", () => {
    assert.equal(parseRange("A1:ZZZZZZ1"), null);
  });
});
