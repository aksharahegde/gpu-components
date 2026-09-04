/**
 * The dependency graph, recalculation, and function library — the CPU-only "engine" half of
 * `GPUSpreadsheet` (PLAN.md §5.2: string handling, dependency graphs, and small-N branchy work stay
 * off the GPU; the raster pass in `SpreadsheetComponent.ts` only ever reads this engine's *output*,
 * a plain numeric/text matrix, the same way `GridComponent.ts` reads `GridData`).
 *
 * On every edit: parse the formula, diff its cell/range references against the previous formula's,
 * update the dependency graph, check whether the edit created a cycle reachable back to itself, and
 * — if not — recalculate only the edited cell plus its transitive dependents, in topological order.
 * Never the whole sheet. §31 open question 3 (the recalculation ceiling) is this loop's cost.
 */

import { type CellRef, cellKey, rangeRefs } from "./cellRef.ts";
import { type FormulaNode, parseFormula } from "./formulaParser.ts";

export type CellErrorCode = "#CIRCULAR!" | "#DIV/0!" | "#VALUE!" | "#NAME?" | "#REF!";

export class FormulaEngineError extends Error {
  readonly code: CellErrorCode;
  constructor(code: CellErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type CellValue = number | string | boolean | null;

interface CellRecord {
  /** Raw input, e.g. `"=SUM(A1:A10)"` or `"42"` or `"hello"` — what the edit overlay shows back. */
  raw: string;
  formula: FormulaNode | null;
  literal: CellValue;
  value: CellValue;
  error: CellErrorCode | null;
  /** Set when `raw` starts with `=` but failed to parse — distinct from `error`, which
   * `evaluateCell` recomputes on every recalculation pass. A parse error has no formula to
   * re-evaluate, so `evaluateCell` must not overwrite it the way it clears a plain empty cell. */
  parseError: CellErrorCode | null;
}

export type FormulaFunction = (args: readonly CellValue[][]) => CellValue;

/** Bounded v1 function library (PLAN.md-style: a fixed set, not app parity). `args` is one array
 * per call argument — a bare cell yields a one-element array, a range yields every cell in it, so
 * aggregate functions and scalar functions share the same calling convention. */
export const DEFAULT_FUNCTIONS: Record<string, FormulaFunction> = {
  SUM: (args) => numbers(args).reduce((a, b) => a + b, 0),
  AVERAGE: (args) => {
    const ns = numbers(args);
    if (ns.length === 0) throw new FormulaEngineError("#DIV/0!", "AVERAGE of zero values");
    return ns.reduce((a, b) => a + b, 0) / ns.length;
  },
  COUNT: (args) => numbers(args).length,
  MIN: (args) => (numbers(args).length ? Math.min(...numbers(args)) : 0),
  MAX: (args) => (numbers(args).length ? Math.max(...numbers(args)) : 0),
  IF: (args) => {
    if (args.length < 2) throw new FormulaEngineError("#VALUE!", "IF needs at least 2 arguments");
    const cond = args[0]![0];
    return truthy(cond) ? args[1]![0]! : (args[2]?.[0] ?? false);
  },
  CONCAT: (args) => args.flat().map((v) => displayText(v)).join(""),
  LEN: (args) => displayText(args[0]?.[0] ?? "").length,
  UPPER: (args) => displayText(args[0]?.[0] ?? "").toUpperCase(),
  LOWER: (args) => displayText(args[0]?.[0] ?? "").toLowerCase(),
  ROUND: (args) => {
    const value = asNumber(args[0]?.[0] ?? 0);
    const digits = args[1] ? asNumber(args[1][0] ?? 0) : 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  },
};

function numbers(args: readonly CellValue[][]): number[] {
  return args.flat().filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function truthy(v: CellValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return false;
}

function asNumber(v: CellValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new FormulaEngineError("#VALUE!", `Expected a number, got ${JSON.stringify(v)}`);
}

export function displayText(v: CellValue): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

/** Every cell ref a formula reads, ranges expanded — the dependency graph's edge set for one cell. */
function collectRefs(node: FormulaNode, out: Set<string>): void {
  switch (node.kind) {
    case "cellRef":
      out.add(cellKey(node.ref));
      return;
    case "rangeRef":
      for (const ref of rangeRefs(node.range)) out.add(cellKey(ref));
      return;
    case "unary":
      collectRefs(node.operand, out);
      return;
    case "binary":
      collectRefs(node.left, out);
      collectRefs(node.right, out);
      return;
    case "call":
      for (const arg of node.args) collectRefs(arg, out);
      return;
    default:
      return;
  }
}

export class FormulaEngine {
  private readonly cells = new Map<string, CellRecord>();
  /** key → set of keys it reads. */
  private readonly deps = new Map<string, Set<string>>();
  /** key → set of keys that read it (the reverse edge, used to find the dirty subgraph). */
  private readonly dependents = new Map<string, Set<string>>();
  private readonly functions: Record<string, FormulaFunction>;

  constructor(functions: Record<string, FormulaFunction> = DEFAULT_FUNCTIONS) {
    this.functions = functions;
  }

  private record(key: string): CellRecord {
    let r = this.cells.get(key);
    if (!r) {
      r = { raw: "", formula: null, literal: null, value: null, error: null, parseError: null };
      this.cells.set(key, r);
    }
    return r;
  }

  getValue(ref: CellRef): CellValue {
    return this.cells.get(cellKey(ref))?.value ?? null;
  }

  getError(ref: CellRef): CellErrorCode | null {
    return this.cells.get(cellKey(ref))?.error ?? null;
  }

  getRaw(ref: CellRef): string {
    return this.cells.get(cellKey(ref))?.raw ?? "";
  }

  getDisplayText(ref: CellRef): string {
    const r = this.cells.get(cellKey(ref));
    if (!r) return "";
    return r.error ?? displayText(r.value);
  }

  /**
   * Sets a cell from raw user input. Returns every cell key that was recalculated (the edited cell
   * plus its transitive dependents) — `SpreadsheetComponent`'s dirty-flash uniform and tests both
   * key off this.
   */
  setCell(ref: CellRef, raw: string): readonly string[] {
    const key = cellKey(ref);
    const trimmed = raw.trim();
    const record = this.record(key);
    record.raw = raw;

    this.clearDeps(key);
    record.parseError = null;

    if (trimmed.startsWith("=")) {
      let node: FormulaNode;
      try {
        node = parseFormula(trimmed.slice(1));
      } catch {
        record.formula = null;
        record.literal = null;
        record.parseError = "#NAME?";
        return this.recalculate(key);
      }
      record.formula = node;
      record.literal = null;
      const refs = new Set<string>();
      collectRefs(node, refs);
      this.setDeps(key, refs);
    } else {
      record.formula = null;
      record.literal = literalFromInput(trimmed);
    }

    // No need to special-case the cycle here: `recalculate`'s topological sort below leaves every
    // cycle member (this edit's cell included, if it created one) unordered and marks it
    // `#CIRCULAR!` directly, without evaluating it.
    return this.recalculate(key);
  }

  /** Clears a cell back to empty. */
  clearCell(ref: CellRef): readonly string[] {
    return this.setCell(ref, "");
  }

  private clearDeps(key: string): void {
    const old = this.deps.get(key);
    if (!old) return;
    for (const dep of old) this.dependents.get(dep)?.delete(key);
    this.deps.delete(key);
  }

  private setDeps(key: string, refs: ReadonlySet<string>): void {
    this.deps.set(key, new Set(refs));
    for (const dep of refs) {
      let set = this.dependents.get(dep);
      if (!set) {
        set = new Set();
        this.dependents.set(dep, set);
      }
      set.add(key);
    }
  }

  /** Every cell reachable from `key` via `dependents` (including `key`), i.e. the dirty subgraph. */
  private affected(key: string): Set<string> {
    const out = new Set<string>([key]);
    const stack = [key];
    while (stack.length) {
      const cur = stack.pop()!;
      const next = this.dependents.get(cur);
      if (!next) continue;
      for (const n of next) {
        if (!out.has(n)) {
          out.add(n);
          stack.push(n);
        }
      }
    }
    return out;
  }

  /** Topologically sorts `subset` by `deps` restricted to that subset (Kahn's algorithm), then
   * evaluates each cell in order. Cells Kahn's algorithm can't place (in-degree never reaches 0)
   * are exactly the cycle members — those get `#CIRCULAR!` directly, never evaluated. */
  private recalculate(editedKey: string): readonly string[] {
    const subset = this.affected(editedKey);
    const inDegree = new Map<string, number>();
    for (const key of subset) inDegree.set(key, 0);
    for (const key of subset) {
      const deps = this.deps.get(key);
      if (!deps) continue;
      for (const dep of deps) {
        if (subset.has(dep)) inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
      }
    }

    const queue = [...subset].filter((k) => inDegree.get(k) === 0);
    const order: string[] = [];
    while (queue.length) {
      const key = queue.shift()!;
      order.push(key);
      for (const dependent of this.dependents.get(key) ?? []) {
        if (!subset.has(dependent)) continue;
        const remaining = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) queue.push(dependent);
      }
    }
    // Anything left out of `order` never reached in-degree 0 — a cycle. Mark it circular *without*
    // evaluating it: its formula reads other cycle members, so evaluating it would only read their
    // still-stale values, not produce a meaningful result.
    const ordered = new Set(order);
    for (const key of subset) {
      if (ordered.has(key)) continue;
      const r = this.record(key);
      r.value = null;
      r.error = "#CIRCULAR!";
    }

    for (const key of order) this.evaluateCell(key);
    return [...order, ...[...subset].filter((k) => !ordered.has(k))];
  }

  private evaluateCell(key: string): void {
    const record = this.record(key);
    if (record.parseError) {
      record.value = null;
      record.error = record.parseError;
      return;
    }
    if (!record.formula) {
      record.value = record.literal;
      record.error = null;
      return;
    }
    try {
      record.value = this.evaluateNode(record.formula);
      record.error = null;
    } catch (err) {
      record.value = null;
      record.error = err instanceof FormulaEngineError ? err.code : "#VALUE!";
    }
  }

  private evaluateNode(node: FormulaNode): CellValue {
    switch (node.kind) {
      case "number":
      case "string":
      case "boolean":
        return node.value;
      case "cellRef": {
        const target = this.cells.get(cellKey(node.ref));
        if (target?.error) throw new FormulaEngineError(target.error, `${cellKey(node.ref)} has an error`);
        return target?.value ?? null;
      }
      case "rangeRef":
        // A bare range used where a scalar is expected (e.g. `=A1:A3 + 1`) — take the first cell,
        // matching how spreadsheet apps treat an accidental range-as-scalar.
        for (const ref of rangeRefs(node.range)) return this.evaluateNode({ kind: "cellRef", ref });
        return null;
      case "unary":
        return -asNumber(this.evaluateNode(node.operand));
      case "binary":
        return this.evaluateBinary(node.op, node.left, node.right);
      case "call":
        return this.evaluateCall(node.name, node.args);
    }
  }

  private evaluateBinary(op: string, leftNode: FormulaNode, rightNode: FormulaNode): CellValue {
    if (op === "&") {
      return displayText(this.evaluateNode(leftNode)) + displayText(this.evaluateNode(rightNode));
    }
    const left = this.evaluateNode(leftNode);
    const right = this.evaluateNode(rightNode);
    switch (op) {
      case "+": return asNumber(left) + asNumber(right);
      case "-": return asNumber(left) - asNumber(right);
      case "*": return asNumber(left) * asNumber(right);
      case "/": {
        const denom = asNumber(right);
        if (denom === 0) throw new FormulaEngineError("#DIV/0!", "division by zero");
        return asNumber(left) / denom;
      }
      case "^": return asNumber(left) ** asNumber(right);
      case "=": return valuesEqual(left, right);
      case "<>": return !valuesEqual(left, right);
      case "<": return asNumber(left) < asNumber(right);
      case "<=": return asNumber(left) <= asNumber(right);
      case ">": return asNumber(left) > asNumber(right);
      case ">=": return asNumber(left) >= asNumber(right);
      default:
        throw new FormulaEngineError("#VALUE!", `Unknown operator "${op}"`);
    }
  }

  private evaluateCall(name: string, argNodes: readonly FormulaNode[]): CellValue {
    const fn = this.functions[name];
    if (!fn) throw new FormulaEngineError("#NAME?", `Unknown function "${name}"`);
    const args = argNodes.map((arg) => this.argValues(arg));
    return fn(args);
  }

  /** A call argument's value list: a range expands to every cell it covers, a bare cell or
   * expression yields one value — the calling convention `DEFAULT_FUNCTIONS` above expects. */
  private argValues(node: FormulaNode): CellValue[] {
    if (node.kind === "rangeRef") {
      const out: CellValue[] = [];
      for (const ref of rangeRefs(node.range)) out.push(this.evaluateNode({ kind: "cellRef", ref }));
      return out;
    }
    return [this.evaluateNode(node)];
  }
}

function valuesEqual(a: CellValue, b: CellValue): boolean {
  if (typeof a === "number" || typeof b === "number") return asNumber(a) === asNumber(b);
  return displayText(a) === displayText(b);
}

/** A bare (non-formula) cell input: numeric if it parses cleanly, boolean for TRUE/FALSE, text
 * otherwise. Empty input is `null` (an empty cell), matching how `formatNumber` treats non-finite
 * values in `registry/grid/ingest.ts`. */
function literalFromInput(trimmed: string): CellValue {
  if (trimmed === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number.parseFloat(trimmed);
  const upper = trimmed.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return trimmed;
}
