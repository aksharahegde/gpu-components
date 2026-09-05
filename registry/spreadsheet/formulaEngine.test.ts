import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCellRef } from "./cellRef.ts";
import { FormulaEngine } from "./formulaEngine.ts";

function ref(a1: string) {
  const r = parseCellRef(a1);
  if (!r) throw new Error(`bad ref ${a1}`);
  return r;
}

describe("FormulaEngine", () => {
  it("evaluates literals", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "42");
    assert.equal(e.getValue(ref("A1")), 42);
    e.setCell(ref("A2"), "hello");
    assert.equal(e.getValue(ref("A2")), "hello");
  });

  it("evaluates arithmetic formulas", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "2");
    e.setCell(ref("A2"), "3");
    e.setCell(ref("A3"), "=A1+A2*2");
    assert.equal(e.getValue(ref("A3")), 8);
  });

  it("propagates edits to dependents, recalculating only the affected subgraph", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "1");
    e.setCell(ref("B1"), "=A1+1");
    e.setCell(ref("C1"), "=B1+1");
    e.setCell(ref("D1"), "100"); // unrelated
    assert.equal(e.getValue(ref("C1")), 3);

    const touched = e.setCell(ref("A1"), "10");
    assert.equal(e.getValue(ref("B1")), 11);
    assert.equal(e.getValue(ref("C1")), 12);
    assert.equal(e.getValue(ref("D1")), 100);
    assert.ok(touched.includes("0,0")); // A1
    assert.ok(touched.includes("1,0")); // B1
    assert.ok(touched.includes("2,0")); // C1
    assert.ok(!touched.includes("3,0")); // D1 untouched
  });

  it("evaluates range aggregate functions", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "1");
    e.setCell(ref("A2"), "2");
    e.setCell(ref("A3"), "3");
    e.setCell(ref("B1"), "=SUM(A1:A3)");
    e.setCell(ref("B2"), "=AVERAGE(A1:A3)");
    e.setCell(ref("B3"), "=COUNT(A1:A3)");
    e.setCell(ref("B4"), "=MIN(A1:A3)");
    e.setCell(ref("B5"), "=MAX(A1:A3)");
    assert.equal(e.getValue(ref("B1")), 6);
    assert.equal(e.getValue(ref("B2")), 2);
    assert.equal(e.getValue(ref("B3")), 3);
    assert.equal(e.getValue(ref("B4")), 1);
    assert.equal(e.getValue(ref("B5")), 3);
  });

  it("evaluates IF and text functions", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "5");
    e.setCell(ref("B1"), '=IF(A1>3,"big","small")');
    assert.equal(e.getValue(ref("B1")), "big");
    e.setCell(ref("C1"), '=UPPER("abc")&LEN("abc")');
    assert.equal(e.getValue(ref("C1")), "ABC3");
  });

  it("detects a direct two-cell cycle without hanging, marking both circular", () => {
    const e = new FormulaEngine();
    e.setCell(ref("B1"), "=A1+1");
    const touched = e.setCell(ref("A1"), "=B1+1");
    assert.equal(e.getError(ref("A1")), "#CIRCULAR!");
    assert.equal(e.getError(ref("B1")), "#CIRCULAR!");
    assert.ok(touched.includes("0,0"));
    assert.ok(touched.includes("1,0"));
  });

  it("detects a self-reference cycle", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "=A1+1");
    assert.equal(e.getError(ref("A1")), "#CIRCULAR!");
  });

  it("recovers from a cycle once it's broken", () => {
    const e = new FormulaEngine();
    e.setCell(ref("B1"), "=A1+1");
    e.setCell(ref("A1"), "=B1+1");
    assert.equal(e.getError(ref("A1")), "#CIRCULAR!");

    e.setCell(ref("A1"), "5"); // break the cycle
    assert.equal(e.getError(ref("A1")), null);
    assert.equal(e.getValue(ref("A1")), 5);
    assert.equal(e.getError(ref("B1")), null);
    assert.equal(e.getValue(ref("B1")), 6);
  });

  it("surfaces division by zero as #DIV/0!", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "=1/0");
    assert.equal(e.getError(ref("A1")), "#DIV/0!");
  });

  it("surfaces an unknown function as #NAME?", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "=NOPE(1)");
    assert.equal(e.getError(ref("A1")), "#NAME?");
  });

  it("surfaces a malformed formula as #NAME? without clobbering on recalculation", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "=1+");
    assert.equal(e.getError(ref("A1")), "#NAME?");
    // A dependent's edit re-triggers this cell's own recalculation path indirectly via `affected`
    // only when something depends on it; here we just re-verify the error persists standalone.
    assert.equal(e.getValue(ref("A1")), null);
  });

  it("propagates an upstream error to a dependent", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "=1/0");
    e.setCell(ref("B1"), "=A1+1");
    assert.equal(e.getError(ref("B1")), "#DIV/0!");
  });

  it("clearing a cell resets it to empty", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "5");
    e.clearCell(ref("A1"));
    assert.equal(e.getValue(ref("A1")), null);
    assert.equal(e.getDisplayText(ref("A1")), "");
  });

  it("degrades an oversized range to #NAME? instead of throwing (DoS regression)", () => {
    const e = new FormulaEngine();
    assert.doesNotThrow(() => e.setCell(ref("A1"), "=SUM(A1:ZZ99999)"));
    assert.equal(e.getError(ref("A1")), "#NAME?");
  });

  it("degrades a row-only oversized range to #NAME? without throwing or hanging", () => {
    const e = new FormulaEngine();
    const start = Date.now();
    assert.doesNotThrow(() => e.setCell(ref("A1"), "=SUM(A1:A2000000)"));
    assert.ok(Date.now() - start < 500, "should reject quickly, not expand the range");
    assert.equal(e.getError(ref("A1")), "#NAME?");
  });

  it("still evaluates a large-but-legal range correctly", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "1");
    e.setCell(ref("B1"), "=SUM(A1:A100000)");
    assert.equal(e.getValue(ref("B1")), 1);
    assert.equal(e.getError(ref("B1")), null);
  });

  it("recovers cleanly after a rejected oversized-range edit: cell shows an error, a later normal edit works and recalculates dependents", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "1");
    e.setCell(ref("B1"), "=A1+1");

    // Overwrite A1 with an oversized-range formula — this must not corrupt the engine's state.
    e.setCell(ref("A1"), "=SUM(A1:ZZ99999)");
    assert.equal(e.getError(ref("A1")), "#NAME?");

    // A normal edit to the same cell afterwards must work and propagate to dependents, proving the
    // engine's dependency graph wasn't left half-updated by the rejected edit.
    const touched = e.setCell(ref("A1"), "10");
    assert.equal(e.getError(ref("A1")), null);
    assert.equal(e.getValue(ref("A1")), 10);
    assert.equal(e.getValue(ref("B1")), 11);
    assert.ok(touched.includes("1,0")); // B1 recalculated
  });

  it("does not dispatch into Object.prototype via an unknown function name", () => {
    const e = new FormulaEngine();
    e.setCell(ref("A1"), "=CONSTRUCTOR()");
    assert.equal(e.getError(ref("A1")), "#NAME?");
    e.setCell(ref("A2"), "=HASOWNPROPERTY()");
    assert.equal(e.getError(ref("A2")), "#NAME?");
  });
});
