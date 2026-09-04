import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FormulaParseError, parseFormula } from "./formulaParser.ts";

describe("parseFormula", () => {
  it("parses arithmetic with correct precedence", () => {
    const ast = parseFormula("1+2*3");
    assert.deepEqual(ast, {
      kind: "binary",
      op: "+",
      left: { kind: "number", value: 1 },
      right: {
        kind: "binary",
        op: "*",
        left: { kind: "number", value: 2 },
        right: { kind: "number", value: 3 },
      },
    });
  });

  it("respects parentheses", () => {
    const ast = parseFormula("(1+2)*3");
    assert.equal(ast.kind, "binary");
    if (ast.kind === "binary") assert.equal(ast.op, "*");
  });

  it("parses right-associative power", () => {
    const ast = parseFormula("2^3^2");
    assert.deepEqual(ast, {
      kind: "binary",
      op: "^",
      left: { kind: "number", value: 2 },
      right: {
        kind: "binary",
        op: "^",
        left: { kind: "number", value: 3 },
        right: { kind: "number", value: 2 },
      },
    });
  });

  it("parses unary minus", () => {
    const ast = parseFormula("-A1");
    assert.deepEqual(ast, {
      kind: "unary",
      op: "-",
      operand: { kind: "cellRef", ref: { col: 0, row: 0 } },
    });
  });

  it("parses cell refs and ranges", () => {
    assert.deepEqual(parseFormula("A1"), { kind: "cellRef", ref: { col: 0, row: 0 } });
    assert.deepEqual(parseFormula("B2:C4"), {
      kind: "rangeRef",
      range: { start: { col: 1, row: 1 }, end: { col: 2, row: 3 } },
    });
  });

  it("parses function calls with multiple args", () => {
    const ast = parseFormula("SUM(A1:A3,10)");
    assert.equal(ast.kind, "call");
    if (ast.kind === "call") {
      assert.equal(ast.name, "SUM");
      assert.equal(ast.args.length, 2);
    }
  });

  it("distinguishes a cell ref from a function name that looks like one", () => {
    // Not a realistic function name, but proves the tokenizer's lookahead-for-`(` rule works.
    const ast = parseFormula("A1()");
    assert.equal(ast.kind, "call");
  });

  it("parses string literals with escaped quotes", () => {
    const ast = parseFormula('"a\\"b"');
    assert.deepEqual(ast, { kind: "string", value: 'a"b' });
  });

  it("parses comparison operators", () => {
    const ast = parseFormula("A1<>B1");
    assert.equal(ast.kind, "binary");
    if (ast.kind === "binary") assert.equal(ast.op, "<>");
  });

  it("parses booleans", () => {
    assert.deepEqual(parseFormula("TRUE"), { kind: "boolean", value: true });
  });

  it("throws FormulaParseError on malformed input", () => {
    assert.throws(() => parseFormula("1+"), FormulaParseError);
    assert.throws(() => parseFormula("(1+2"), FormulaParseError);
    assert.throws(() => parseFormula('"unterminated'), FormulaParseError);
  });
});
