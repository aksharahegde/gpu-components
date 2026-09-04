/**
 * Formula string → AST. Hand-rolled per `spikes/spreadsheet-formula-engine.md`'s v1 default: a
 * bounded subset (arithmetic, comparison, ranges, a fixed function library — see
 * `formulaEngine.ts`), not full spreadsheet-app parity. CPU-only, per PLAN.md §5.2 — this never
 * touches the GPU.
 */

import { type CellRange, type CellRef, parseCellRef, parseRange } from "./cellRef.ts";

export type BinaryOperator = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | "<=" | ">" | ">=";

export type FormulaNode =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "cellRef"; readonly ref: CellRef }
  | { readonly kind: "rangeRef"; readonly range: CellRange }
  | { readonly kind: "unary"; readonly op: "-"; readonly operand: FormulaNode }
  | { readonly kind: "binary"; readonly op: BinaryOperator; readonly left: FormulaNode; readonly right: FormulaNode }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly FormulaNode[] };

export class FormulaParseError extends Error {}

type TokenType =
  | "number"
  | "string"
  | "ident"
  | "range"
  | "cellRef"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

interface Token {
  readonly type: TokenType;
  readonly text: string;
}

const RANGE_RE = /^[A-Za-z]+\d+:[A-Za-z]+\d+/;
const CELL_RE = /^[A-Za-z]+\d+/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;
const NUMBER_RE = /^\d+(\.\d+)?/;
const OPS = ["<>", "<=", ">=", "+", "-", "*", "/", "^", "&", "=", "<", ">"];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", text: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", text: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", text: ch });
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = "";
      while (j < source.length && source[j] !== '"') {
        // `""` inside a quoted string is an escaped quote, the same convention spreadsheet formula
        // strings use.
        if (source[j] === "\\" && source[j + 1] === '"') {
          value += '"';
          j += 2;
          continue;
        }
        value += source[j];
        j++;
      }
      if (j >= source.length) throw new FormulaParseError(`Unterminated string in "${source}"`);
      tokens.push({ type: "string", text: value });
      i = j + 1;
      continue;
    }

    const rest = source.slice(i);
    const rangeMatch = RANGE_RE.exec(rest);
    if (rangeMatch) {
      tokens.push({ type: "range", text: rangeMatch[0] });
      i += rangeMatch[0].length;
      continue;
    }
    const cellMatch = CELL_RE.exec(rest);
    // A bare cell ref and a function name both start with letters — only treat it as a cell ref if
    // it is not immediately followed by `(`, which would make it a function call instead.
    if (cellMatch && source[i + cellMatch[0].length] !== "(") {
      tokens.push({ type: "cellRef", text: cellMatch[0] });
      i += cellMatch[0].length;
      continue;
    }
    const identMatch = IDENT_RE.exec(rest);
    if (identMatch) {
      tokens.push({ type: "ident", text: identMatch[0] });
      i += identMatch[0].length;
      continue;
    }
    const numberMatch = NUMBER_RE.exec(rest);
    if (numberMatch) {
      tokens.push({ type: "number", text: numberMatch[0] });
      i += numberMatch[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      tokens.push({ type: "op", text: op });
      i += op.length;
      continue;
    }
    throw new FormulaParseError(`Unexpected character "${ch}" in "${source}"`);
  }
  tokens.push({ type: "eof", text: "" });
  return tokens;
}

class Parser {
  private pos = 0;
  private readonly tokens: readonly Token[];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private advance(): Token {
    return this.tokens[this.pos++]!;
  }

  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) throw new FormulaParseError(`Expected ${type}, got "${t.text || "<eof>"}"`);
    return this.advance();
  }

  parseFormula(): FormulaNode {
    const node = this.parseComparison();
    this.expect("eof");
    return node;
  }

  private parseComparison(): FormulaNode {
    let left = this.parseConcat();
    while (this.peek().type === "op" && ["=", "<>", "<", "<=", ">", ">="].includes(this.peek().text)) {
      const op = this.advance().text as BinaryOperator;
      left = { kind: "binary", op, left, right: this.parseConcat() };
    }
    return left;
  }

  private parseConcat(): FormulaNode {
    let left = this.parseAdditive();
    while (this.peek().type === "op" && this.peek().text === "&") {
      this.advance();
      left = { kind: "binary", op: "&", left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): FormulaNode {
    let left = this.parseMultiplicative();
    while (this.peek().type === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.advance().text as "+" | "-";
      left = { kind: "binary", op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): FormulaNode {
    let left = this.parseUnary();
    while (this.peek().type === "op" && (this.peek().text === "*" || this.peek().text === "/")) {
      const op = this.advance().text as "*" | "/";
      left = { kind: "binary", op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): FormulaNode {
    if (this.peek().type === "op" && this.peek().text === "-") {
      this.advance();
      return { kind: "unary", op: "-", operand: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): FormulaNode {
    const base = this.parsePrimary();
    if (this.peek().type === "op" && this.peek().text === "^") {
      this.advance();
      // Right-associative: `2^3^2` is `2^(3^2)`.
      return { kind: "binary", op: "^", left: base, right: this.parseUnary() };
    }
    return base;
  }

  private parsePrimary(): FormulaNode {
    const t = this.peek();
    if (t.type === "number") {
      this.advance();
      return { kind: "number", value: Number.parseFloat(t.text) };
    }
    if (t.type === "string") {
      this.advance();
      return { kind: "string", value: t.text };
    }
    if (t.type === "range") {
      this.advance();
      const range = parseRange(t.text);
      if (!range) throw new FormulaParseError(`Invalid range "${t.text}"`);
      return { kind: "rangeRef", range };
    }
    if (t.type === "cellRef") {
      this.advance();
      const ref = parseCellRef(t.text);
      if (!ref) throw new FormulaParseError(`Invalid cell reference "${t.text}"`);
      return { kind: "cellRef", ref };
    }
    if (t.type === "ident") {
      this.advance();
      const upper = t.text.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return { kind: "boolean", value: upper === "TRUE" };
      this.expect("lparen");
      const args: FormulaNode[] = [];
      if (this.peek().type !== "rparen") {
        args.push(this.parseComparison());
        while (this.peek().type === "comma") {
          this.advance();
          args.push(this.parseComparison());
        }
      }
      this.expect("rparen");
      return { kind: "call", name: upper, args };
    }
    if (t.type === "lparen") {
      this.advance();
      const inner = this.parseComparison();
      this.expect("rparen");
      return inner;
    }
    throw new FormulaParseError(`Unexpected token "${t.text || "<eof>"}"`);
  }
}

/** Parses a formula body — the part after the leading `=`, which callers strip before calling this. */
export function parseFormula(source: string): FormulaNode {
  return new Parser(tokenize(source)).parseFormula();
}
