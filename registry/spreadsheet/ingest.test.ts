import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCellRef } from "./cellRef.ts";
import { FormulaEngine } from "./formulaEngine.ts";
import { buildSpreadsheetData, columnAt, columnOffset, defaultColumns, totalWidth } from "./ingest.ts";

function ref(a1: string) {
  const r = parseCellRef(a1);
  if (!r) throw new Error(`bad ref ${a1}`);
  return r;
}

describe("buildSpreadsheetData", () => {
  it("builds a numeric matrix and a sheet-wide range from mixed cell types", () => {
    const engine = new FormulaEngine();
    engine.setCell(ref("A1"), "1");
    engine.setCell(ref("B1"), "hello");
    engine.setCell(ref("A2"), "=A1*10");
    engine.setCell(ref("B2"), "=1/0");

    const columns = defaultColumns(2);
    const data = buildSpreadsheetData(engine, columns, 2);

    assert.equal(data.numeric[0 * 2 + 0], 1);
    assert.ok(Number.isNaN(data.numeric[0 * 2 + 1])); // B1 is text
    assert.equal(data.numeric[1 * 2 + 0], 10);
    assert.ok(Number.isNaN(data.numeric[1 * 2 + 1])); // B2 is an error

    assert.deepEqual(data.range, [1, 10]);
    assert.equal(data.text[1]![0], "hello");
    assert.equal(data.errors[1]![1], "#DIV/0!");
  });

  it("falls back to [0,1] when there are no finite numeric cells", () => {
    const engine = new FormulaEngine();
    engine.setCell(ref("A1"), "text only");
    const data = buildSpreadsheetData(engine, defaultColumns(1), 1);
    assert.deepEqual(data.range, [0, 1]);
  });
});

describe("column geometry", () => {
  const columns = defaultColumns(3, 50); // A@0-50, B@50-100, C@100-150

  it("computes offsets and total width", () => {
    assert.equal(columnOffset({ columns }, 0), 0);
    assert.equal(columnOffset({ columns }, 1), 50);
    assert.equal(columnOffset({ columns }, 2), 100);
    assert.equal(totalWidth({ columns }), 150);
  });

  it("finds the column at a pixel offset", () => {
    assert.equal(columnAt({ columns }, 0), 0);
    assert.equal(columnAt({ columns }, 49), 0);
    assert.equal(columnAt({ columns }, 50), 1);
    assert.equal(columnAt({ columns }, 149), 2);
    assert.equal(columnAt({ columns }, 150), -1);
    assert.equal(columnAt({ columns }, -1), -1);
  });
});
