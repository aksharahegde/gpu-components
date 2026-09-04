import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCellRef } from "./cellRef.ts";
import { commitEdit, parseTSV, pasteGrid, serializeRangeToTSV, startEdit, updateDraft } from "./editing.ts";
import { FormulaEngine } from "./formulaEngine.ts";

function ref(a1: string) {
  const r = parseCellRef(a1);
  if (!r) throw new Error(`bad ref ${a1}`);
  return r;
}

describe("edit session", () => {
  it("starts, updates, and commits a draft into the engine", () => {
    const engine = new FormulaEngine();
    let session = startEdit(ref("A1"), "");
    session = updateDraft(session, "=1+2");
    commitEdit(engine, session);
    assert.equal(engine.getValue(ref("A1")), 3);
  });
});

describe("parseTSV", () => {
  it("splits rows on newlines and cells on tabs", () => {
    assert.deepEqual(parseTSV("a\tb\nc\td"), [["a", "b"], ["c", "d"]]);
  });

  it("treats a bare value as a 1x1 grid", () => {
    assert.deepEqual(parseTSV("42"), [["42"]]);
  });

  it("normalizes CRLF and a trailing newline", () => {
    assert.deepEqual(parseTSV("a\tb\r\nc\td\r\n"), [["a", "b"], ["c", "d"]]);
  });
});

describe("clipboard round-trip", () => {
  it("serializes a range and pastes it back elsewhere unchanged", () => {
    const engine = new FormulaEngine();
    engine.setCell(ref("A1"), "1");
    engine.setCell(ref("B1"), "2");
    engine.setCell(ref("A2"), "3");
    engine.setCell(ref("B2"), "4");

    const tsv = serializeRangeToTSV(engine, ref("A1"), 2, 2);
    assert.equal(tsv, "1\t2\n3\t4");

    const touched = pasteGrid(engine, ref("D1"), parseTSV(tsv));
    assert.equal(engine.getValue(ref("D1")), 1);
    assert.equal(engine.getValue(ref("E1")), 2);
    assert.equal(engine.getValue(ref("D2")), 3);
    assert.equal(engine.getValue(ref("E2")), 4);
    assert.equal(touched.length, 4);
  });

  it("pastes formulas literally, not adjusted for the new position", () => {
    // v1 has no relative-reference adjustment on paste — pasting a formula re-evaluates it against
    // the *same* absolute cells at the new location. Documented here as current behavior.
    const engine = new FormulaEngine();
    engine.setCell(ref("A1"), "5");
    const touched = pasteGrid(engine, ref("C1"), [["=A1*2"]]);
    assert.equal(engine.getValue(ref("C1")), 10);
    assert.ok(touched.includes("2,0"));
  });
});
