import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestTopology, KIND, STATUS } from "./ingest.ts";

describe("ingestTopology", () => {
  it("builds CSR and packs kind/status/health/traffic", () => {
    const { topology, droppedEdges } = ingestTopology({
      nodes: [
        { label: "r0", kind: "region", status: "up" },
        { label: "svc", kind: "service", status: "degraded" },
        { label: "pod", kind: "pod", status: "down" },
      ],
      edges: [{ source: 0, target: 1, health: 0.9, traffic: 0.5 }],
      seed: 1,
    });
    assert.equal(droppedEdges, 0);
    assert.equal(topology.nodeCount, 3);
    assert.equal(topology.edgeCount, 1);
    assert.equal(topology.kind[0], KIND.region);
    assert.equal(topology.status[1], STATUS.degraded);
    assert.equal(topology.status[2], STATUS.down);
    assert.ok(Math.abs(topology.edgeHealth[0]! - 0.9) < 1e-6);
    assert.ok(Math.abs(topology.edgeTraffic[0]! - 0.5) < 1e-6);
    assert.equal(topology.adjacencyItems.length, 2);
    assert.equal(topology.labels?.[1], "svc");
  });

  it("clamps health/traffic and drops bad endpoints", () => {
    const { topology, droppedEdges } = ingestTopology({
      nodes: [
        { kind: "host", status: "up" },
        { kind: "host", status: "up" },
      ],
      edges: [
        { source: 0, target: 1, health: 2, traffic: -1 },
        { source: 0, target: 9, health: 1, traffic: 1 },
        { source: 1, target: 1, health: 1, traffic: 1 },
      ],
    });
    assert.equal(topology.edgeCount, 1);
    assert.equal(droppedEdges, 2);
    assert.equal(topology.edgeHealth[0], 1);
    assert.equal(topology.edgeTraffic[0], 0);
  });

  it("rejects empty node lists", () => {
    assert.throws(() => ingestTopology({ nodes: [], edges: [] }), /at least one node/);
  });

  it("is deterministic for a given seed", () => {
    const a = ingestTopology({
      nodes: [{ kind: "pod", status: "up" }, { kind: "pod", status: "up" }],
      edges: [{ source: 0, target: 1, health: 1, traffic: 1 }],
      seed: 7,
    }).topology.positions;
    const b = ingestTopology({
      nodes: [{ kind: "pod", status: "up" }, { kind: "pod", status: "up" }],
      edges: [{ source: 0, target: 1, health: 1, traffic: 1 }],
      seed: 7,
    }).topology.positions;
    assert.deepEqual([...a], [...b]);
  });
});
