import {
  ingestTopology,
  type NodeStatus,
  type RawTopologyEdge,
  type RawTopologyNode,
  type TopologyData,
} from "./ingest.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMesh(options: {
  readonly mode: "schematic" | "stress";
  readonly seed?: number;
}): TopologyData {
  const seed = options.seed ?? 0x7e55;
  if (options.mode === "schematic") return buildSchematic(seed);
  return buildStress(seed);
}

function pickStatus(rnd: () => number): NodeStatus {
  const r = rnd();
  if (r < 0.02) return "down";
  if (r < 0.07) return "degraded";
  return "up";
}

function healthForStatus(status: NodeStatus, rnd: () => number): number {
  if (status === "down") return 0.05 + rnd() * 0.15;
  if (status === "degraded") return 0.35 + rnd() * 0.3;
  return 0.75 + rnd() * 0.25;
}

function buildSchematic(seed: number): TopologyData {
  const rnd = mulberry32(seed);
  const nodes: RawTopologyNode[] = [];
  const edges: RawTopologyEdge[] = [];

  const regions = 3;
  const azsPerRegion = 3;
  const servicesPerAz = 8;
  const podsPerService = 4;

  for (let r = 0; r < regions; r++) {
    nodes.push({ id: `region-${r}`, label: `region-${r}`, kind: "region", status: pickStatus(rnd) });
  }

  const azStart = nodes.length;
  for (let r = 0; r < regions; r++) {
    for (let a = 0; a < azsPerRegion; a++) {
      const idx = nodes.length;
      nodes.push({ id: `az-${r}-${a}`, label: `az-${r}-${a}`, kind: "az", status: pickStatus(rnd) });
      edges.push({
        source: r,
        target: idx,
        health: healthForStatus(nodes[r]!.status, rnd),
        traffic: rnd(),
      });
    }
  }

  const serviceStart = nodes.length;
  for (let r = 0; r < regions; r++) {
    for (let a = 0; a < azsPerRegion; a++) {
      const azIdx = azStart + r * azsPerRegion + a;
      for (let s = 0; s < servicesPerAz; s++) {
        const idx = nodes.length;
        nodes.push({
          id: `svc-${r}-${a}-${s}`,
          label: `svc-${r}-${a}-${s}`,
          kind: "service",
          status: pickStatus(rnd),
        });
        edges.push({
          source: azIdx,
          target: idx,
          health: healthForStatus(nodes[azIdx]!.status, rnd),
          traffic: rnd(),
        });
      }
    }
  }

  for (let r = 0; r < regions; r++) {
    for (let a = 0; a < azsPerRegion; a++) {
      for (let s = 0; s < servicesPerAz; s++) {
        const svcIdx = serviceStart + (r * azsPerRegion + a) * servicesPerAz + s;
        for (let p = 0; p < podsPerService; p++) {
          const idx = nodes.length;
          nodes.push({
            id: `pod-${r}-${a}-${s}-${p}`,
            label: `pod-${r}-${a}-${s}-${p}`,
            kind: "pod",
            status: pickStatus(rnd),
          });
          edges.push({
            source: svcIdx,
            target: idx,
            health: healthForStatus(nodes[svcIdx]!.status, rnd),
            traffic: rnd(),
          });
        }
      }
    }
  }

  const crossLinkCount = Math.floor(servicesPerAz * azsPerRegion * regions * 0.15);
  for (let i = 0; i < crossLinkCount; i++) {
    const a = serviceStart + Math.floor(rnd() * (nodes.length - serviceStart));
    let b = serviceStart + Math.floor(rnd() * (nodes.length - serviceStart));
    if (a === b) b = (b + 1) % (nodes.length - serviceStart) + serviceStart;
    const srcStatus = nodes[a]!.status;
    const tgtStatus = nodes[b]!.status;
    const worst = srcStatus === "down" || tgtStatus === "down" ? "down" : srcStatus === "degraded" || tgtStatus === "degraded" ? "degraded" : "up";
    edges.push({
      source: a,
      target: b,
      health: healthForStatus(worst, rnd),
      traffic: rnd(),
    });
  }

  return ingestTopology({ nodes, edges, seed }).topology;
}

function buildStress(seed: number): TopologyData {
  const rnd = mulberry32(seed);
  const nodeCount = 4000;
  const nodes: RawTopologyNode[] = [];
  const edges: RawTopologyEdge[] = [];

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `host-${i}`,
      label: `host-${i}`,
      kind: i % 3 === 0 ? "host" : "pod",
      status: pickStatus(rnd),
    });
  }

  for (let i = 0; i < nodeCount; i++) {
    const linkCount = 2 + Math.floor(rnd() * 3);
    const targets = new Set<number>();
    for (let j = 0; j < linkCount; j++) {
      let target: number;
      if (rnd() < 0.01) {
        target = Math.floor(rnd() * i);
      } else {
        target = i + 1 + Math.floor(rnd() * (nodeCount - i - 1));
      }
      if (target < 0 || target >= nodeCount || target === i || targets.has(target)) continue;
      targets.add(target);
      const srcStatus = nodes[i]!.status;
      const tgtStatus = nodes[target]!.status;
      const worst = srcStatus === "down" || tgtStatus === "down" ? "down" : srcStatus === "degraded" || tgtStatus === "degraded" ? "degraded" : "up";
      edges.push({
        source: i,
        target,
        health: healthForStatus(worst, rnd),
        traffic: rnd(),
      });
    }
  }

  return ingestTopology({ nodes, edges, seed }).topology;
}
