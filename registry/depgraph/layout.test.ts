import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutDepGraph, MAX_LINE_SEGMENTS } from "./layout.ts";

function cats(n: number): Uint8Array {
  return new Uint8Array(n);
}

describe("Sugiyama layout", () => {
  it("assigns increasing ranks along a chain", () => {
    const laid = layoutDepGraph({
      nodeCount: 4,
      edges: [
        { source: 0, target: 1 },
        { source: 1, target: 2 },
        { source: 2, target: 3 },
      ],
      categories: cats(4),
    });
    assert.deepEqual([...laid.ranks], [0, 1, 2, 3]);
    assert.equal(laid.flags[0]! & 1, 1);
    // Vertical chain: horizontal mid-segments collapse, so ≥2 segments per edge.
    assert.ok(laid.segments.length >= 3 * 2);
  });

  it("marks a feedback edge in a 2-cycle and still lays both nodes out", () => {
    const laid = layoutDepGraph({
      nodeCount: 2,
      edges: [
        { source: 0, target: 1 },
        { source: 1, target: 0 },
      ],
      categories: cats(2),
    });
    const backCount = [...laid.backEdgeMask].reduce((a, b) => a + b, 0);
    assert.equal(backCount, 1);
    assert.ok(laid.segments.some((s) => s.backEdge));
    assert.ok(laid.segments.some((s) => !s.backEdge));
  });

  it("keeps forward subgraph ranks acyclic on a diamond with a cycle", () => {
    const edges = [
      { source: 0, target: 1 },
      { source: 0, target: 2 },
      { source: 1, target: 3 },
      { source: 2, target: 3 },
      { source: 3, target: 1 }, // cycle
    ];
    const laid = layoutDepGraph({ nodeCount: 4, edges, categories: cats(4) });
    assert.equal(laid.backEdgeMask[4], 1);
    for (let i = 0; i < edges.length; i++) {
      if (laid.backEdgeMask[i]) continue;
      const e = edges[i]!;
      assert.ok(
        laid.ranks[e.target]! > laid.ranks[e.source]!,
        `forward edge ${e.source}→${e.target} should increase rank`,
      );
    }
  });

  it("places roots at the top layer and pads bounds", () => {
    const laid = layoutDepGraph({
      nodeCount: 3,
      edges: [
        { source: 0, target: 1 },
        { source: 0, target: 2 },
      ],
      categories: cats(3),
    });
    assert.equal(laid.ranks[0], 0);
    assert.ok(laid.bounds.xMin < Math.min(...laid.x));
    assert.ok(laid.bounds.xMax > Math.max(...laid.x));
    assert.ok(laid.bounds.yMin < Math.min(...laid.y));
    assert.ok(laid.bounds.yMax > Math.max(...laid.y));
  });

  it("caps orthogonal segments at MAX_LINE_SEGMENTS", () => {
    const n = 80;
    const edges: { source: number; target: number }[] = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 8, n); j++) {
        edges.push({ source: i, target: j });
      }
    }
    const laid = layoutDepGraph({ nodeCount: n, edges, categories: cats(n) });
    assert.ok(laid.segments.length <= MAX_LINE_SEGMENTS);
    assert.ok(laid.segments.length > 0);
  });
});
