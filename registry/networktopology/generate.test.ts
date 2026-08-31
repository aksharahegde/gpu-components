import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateMesh } from "./generate.ts";
import { STATUS } from "./ingest.ts";

describe("generateMesh", () => {
  it("builds a schematic mesh near 300 nodes with mixed status", () => {
    const g = generateMesh({ mode: "schematic", seed: 1 });
    assert.ok(g.nodeCount >= 250 && g.nodeCount <= 400);
    assert.ok(g.edgeCount > g.nodeCount);
    assert.ok([...g.status].some((s) => s === STATUS.degraded || s === STATUS.down));
    assert.ok([...g.edgeTraffic].some((t) => t > 0.5));
  });

  it("builds a stress mesh near 4000 nodes", () => {
    const g = generateMesh({ mode: "stress", seed: 1 });
    assert.ok(g.nodeCount >= 3500 && g.nodeCount <= 4500);
  });

  it("is deterministic per mode+seed", () => {
    const a = generateMesh({ mode: "schematic", seed: 9 });
    const b = generateMesh({ mode: "schematic", seed: 9 });
    assert.deepEqual([...a.positions], [...b.positions]);
    assert.deepEqual([...a.edges], [...b.edges]);
  });
});
