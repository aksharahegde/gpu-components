import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePivot, pivotableColumns, type PivotSourceRow } from "./pivot.ts";

const ROWS: PivotSourceRow[] = [
  { region: "west", product: "widget", amount: 10 },
  { region: "west", product: "widget", amount: 5 },
  { region: "east", product: "widget", amount: 7 },
  { region: "west", product: "gadget", amount: 3 },
];

describe("computePivot", () => {
  it("groups by one column and sums the value column", () => {
    const data = computePivot(ROWS, { groupBy: ["region"], valueColumn: "amount", aggregate: "sum" });
    assert.equal(data.rowCount, 2);
    assert.equal(data.columns.length, 2);

    const west = data.text[0]!.indexOf("west");
    const east = data.text[0]!.indexOf("east");
    assert.equal(data.numeric[west * 2 + 1], 18); // 10 + 5 + 3
    assert.equal(data.numeric[east * 2 + 1], 7);
  });

  it("supports count, avg, min, max", () => {
    const count = computePivot(ROWS, { groupBy: ["region"], valueColumn: "amount", aggregate: "count" });
    const west = count.text[0]!.indexOf("west");
    assert.equal(count.numeric[west * 2 + 1], 3);

    const avg = computePivot(ROWS, { groupBy: ["region"], valueColumn: "amount", aggregate: "avg" });
    assert.equal(avg.numeric[avg.text[0]!.indexOf("west") * 2 + 1], 6);

    const min = computePivot(ROWS, { groupBy: ["region"], valueColumn: "amount", aggregate: "min" });
    assert.equal(min.numeric[min.text[0]!.indexOf("west") * 2 + 1], 3);

    const max = computePivot(ROWS, { groupBy: ["region"], valueColumn: "amount", aggregate: "max" });
    assert.equal(max.numeric[max.text[0]!.indexOf("west") * 2 + 1], 10);
  });

  it("supports multi-column grouping", () => {
    const data = computePivot(ROWS, {
      groupBy: ["region", "product"],
      valueColumn: "amount",
      aggregate: "sum",
    });
    assert.equal(data.rowCount, 3); // west/widget, east/widget, west/gadget
    assert.equal(data.columns.length, 3);
  });

  it("computes a sheet-wide range across aggregate results", () => {
    const data = computePivot(ROWS, { groupBy: ["region"], valueColumn: "amount", aggregate: "sum" });
    assert.deepEqual([...data.range].sort((a, b) => a - b), [7, 18]);
  });

  it("throws when groupBy is empty", () => {
    assert.throws(() => computePivot(ROWS, { groupBy: [], valueColumn: "amount", aggregate: "sum" }));
  });

  it("lists every distinct source column", () => {
    const cols = pivotableColumns(ROWS);
    assert.ok(cols.includes("region"));
    assert.ok(cols.includes("product"));
    assert.ok(cols.includes("amount"));
  });
});
