# GPUNetworkTopology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a playground-only infra/service-mesh topology viewer: GPU force layout with kind/status node styling, link health/traffic, and an edge traffic pulse.

**Architecture:** Local fork of `registry/graph` under `registry/networktopology/` (layout compute + GPU-resident positions). Domain ingest adds kind/status/health/traffic buffers; render shaders consume them. Not added to the CLI registry (same exclusion as `GPUGraph`).

**Tech Stack:** TypeScript, WGSL via `vgpu`, `@gpu-components/core` + `@gpu-components/react`, node:test + Dawn pixel smoke, Next.js site demo.

**Spec:** `docs/superpowers/specs/2026-08-31-gpunetworktopology-design.md`

## Global Constraints

- Product shape: infra / service mesh schematic (not geo, not package DAG).
- Layout: GPU force layout with continuous settle (`animating` until iteration cap / pause).
- Distribution: playground + tests only — **do not** add to `packages/cli/scripts/buildRegistry.mjs`.
- Domain encoding: kind + status + link health + traffic pulse.
- Demo: dual modes — schematic (~300 nodes) and stress (~4k nodes).
- Core: zero `@gpu-components/core` API changes in v1.
- Hover: none in v1 (`hitTest` returns `null`).
- Never explain code unless asked (user preference); still write clear tests and commit messages.
- Follow existing graph patterns for create/update/plan/iterate; copy then adapt rather than inventing a new layout kernel.

## File map

| Path | Responsibility |
|------|----------------|
| `registry/networktopology/ingest.ts` | Types, enum encoding, `ingestTopology`, CSR + seeded positions |
| `registry/networktopology/generate.ts` | `generateMesh({ mode, seed })` |
| `registry/networktopology/layout.wgsl.ts` | Force layout WGSL (copy from graph) |
| `registry/networktopology/topology.wgsl.ts` | Node + edge shaders (kind/status/health/pulse) |
| `registry/networktopology/NetworkTopologyComponent.ts` | GPU component |
| `registry/networktopology/GPUNetworkTopology.tsx` | React wrapper |
| `registry/networktopology/index.ts` | Exports |
| `registry/networktopology/topology.test.ts` | Ingest + component mock tests |
| `registry/networktopology/generate.test.ts` | Generator size/determinism |
| `registry/networktopology/render.pixels.test.ts` | Dawn smoke |
| `package.json` | `test:registry` glob |
| `apps/site/...` | Demo + playground + matrix tag |

**Reference files (read, do not modify unless noted):**

- `registry/graph/ingest.ts`, `GraphComponent.ts`, `GPUGraph.tsx`, `layout.wgsl.ts`, `graph.wgsl.ts`, `graph.test.ts`, `render.pixels.test.ts`
- `apps/site/src/components/demos/chrome.tsx` (`Segmented`, `Hint`, `useMeasuredStage`)
- `apps/site/src/components/demos/DepGraphDemo.tsx` / graph playground page for site patterns

---

### Task 1: Ingest + enum packing

**Files:**
- Create: `registry/networktopology/ingest.ts`
- Create: `registry/networktopology/topology.test.ts` (ingest suite only first)
- Test: `registry/networktopology/topology.test.ts`

**Interfaces:**
- Consumes: nothing from later tasks
- Produces:
  - `KIND = { region: 0, az: 1, service: 2, pod: 3, host: 4 }`
  - `STATUS = { up: 0, degraded: 1, down: 2 }`
  - `POSITION_STRIDE = 8`, `EDGE_STRIDE = 8`, `RECOMMENDED_MAX_NODES = 5000`
  - `ingestTopology(input): { topology: TopologyData; droppedEdges: number }`
  - `TopologyData` with graph layout fields + `kind`, `status`, `edgeHealth`, `edgeTraffic`, `labels`

- [ ] **Step 1: Write the failing ingest tests**

Create `registry/networktopology/topology.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --experimental-strip-types --import ./registry/timeline/test/register.mjs --test registry/networktopology/topology.test.ts
```

Expected: module not found / cannot find `./ingest.ts`.

- [ ] **Step 3: Implement `ingest.ts`**

Mirror CSR + seeded ring positions from `registry/graph/ingest.ts`, but accept domain nodes/edges:

```ts
export const KIND = { region: 0, az: 1, service: 2, pod: 3, host: 4 } as const;
export type NodeKind = keyof typeof KIND;
export const STATUS = { up: 0, degraded: 1, down: 2 } as const;
export type NodeStatus = keyof typeof STATUS;

export const POSITION_STRIDE = 8;
export const EDGE_STRIDE = 8;
export const RECOMMENDED_MAX_NODES = 5_000;

export interface RawTopologyNode {
  readonly id?: string;
  readonly label?: string;
  readonly kind: NodeKind;
  readonly status: NodeStatus;
}
export interface RawTopologyEdge {
  readonly source: number;
  readonly target: number;
  readonly health: number;
  readonly traffic: number;
}
export interface TopologyInput {
  readonly nodes: readonly RawTopologyNode[];
  readonly edges: readonly RawTopologyEdge[];
  readonly seed?: number;
}

export interface TopologyData {
  readonly nodeCount: number;
  readonly positions: Float32Array<ArrayBuffer>;
  readonly kind: Uint8Array;
  readonly status: Uint8Array;
  readonly edges: Uint32Array<ArrayBuffer>;
  readonly edgeCount: number;
  readonly edgeHealth: Float32Array<ArrayBuffer>;
  readonly edgeTraffic: Float32Array<ArrayBuffer>;
  readonly adjacencyStarts: Uint32Array<ArrayBuffer>;
  readonly adjacencyItems: Uint32Array<ArrayBuffer>;
  readonly labels: readonly string[];
}

function mulberry32(seed: number): () => number { /* copy from graph ingest */ }

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function ingestTopology(input: TopologyInput): {
  readonly topology: TopologyData;
  readonly droppedEdges: number;
} {
  const nodeCount = input.nodes.length;
  if (nodeCount === 0) {
    throw new RangeError("gpu-components/networktopology: at least one node is required");
  }
  // seed positions like ingestGraph; validate edges like ingestGraph (drop bad);
  // pack kind/status bytes; clamp health/traffic into Float32Arrays aligned with kept edges;
  // build undirected CSR for layout attraction.
  // …
}
```

Fill in the `…` by adapting `ingestGraph` loop bodies from `registry/graph/ingest.ts` (same drop rules: non-integer, OOB, self-loop). Keep a `category`-compatible packing path unused — kind and status are separate byte arrays.

- [ ] **Step 4: Run tests — expect PASS**

Same command as Step 2. Expected: all ingest tests pass.

- [ ] **Step 5: Commit**

```bash
git add registry/networktopology/ingest.ts registry/networktopology/topology.test.ts
git commit -m "$(cat <<'EOF'
Add GPUNetworkTopology ingest with kind, status, and link metrics.

EOF
)"
```

---

### Task 2: Mesh generators

**Files:**
- Create: `registry/networktopology/generate.ts`
- Create: `registry/networktopology/generate.test.ts`

**Interfaces:**
- Consumes: `ingestTopology` from Task 1
- Produces: `generateMesh({ mode: "schematic" | "stress"; seed?: number }): TopologyData`

- [ ] **Step 1: Write failing generator tests**

```ts
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
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

```bash
node --experimental-strip-types --import ./registry/timeline/test/register.mjs --test registry/networktopology/generate.test.ts
```

- [ ] **Step 3: Implement `generate.ts`**

```ts
import { ingestTopology, type TopologyData } from "./ingest.ts";

export function generateMesh(options: {
  readonly mode: "schematic" | "stress";
  readonly seed?: number;
}): TopologyData {
  const seed = options.seed ?? 0x7e55;
  if (options.mode === "schematic") return buildSchematic(seed);
  return buildStress(seed);
}

function buildSchematic(seed: number): TopologyData {
  // Hierarchy: 3 regions × 3 AZs × ~8 services × ~4 pods ≈ ~300 nodes.
  // Edges: parent→child plus a few cross-service links.
  // Mark ~5% degraded, ~2% down; set health/traffic accordingly (down links health low).
  // Call ingestTopology({ nodes, edges, seed }).topology
}

function buildStress(seed: number): TopologyData {
  // ~4000 hosts/pods; each node links to 2–4 higher-index targets (mostly DAG-ish) + ~1% cycles.
  // Mostly status up; sprinkle degraded/down; traffic random in [0,1].
}
```

Use `mulberry32` locally (or export from ingest if you prefer one PRNG). Keep construction CPU-only and finish with `ingestTopology`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add registry/networktopology/generate.ts registry/networktopology/generate.test.ts
git commit -m "$(cat <<'EOF'
Add schematic and stress mesh generators for GPUNetworkTopology.

EOF
)"
```

---

### Task 3: Layout + topology shaders

**Files:**
- Create: `registry/networktopology/layout.wgsl.ts` (copy `registry/graph/layout.wgsl.ts` unchanged aside from comments mentioning networktopology)
- Create: `registry/networktopology/topology.wgsl.ts`

**Interfaces:**
- Consumes: kind/status/health/traffic buffer layouts from Task 1
- Produces: `LAYOUT_WGSL`, `LAYOUT_WORKGROUP_SIZE`, `NODE_WGSL`, `EDGE_WGSL`

- [ ] **Step 1: Copy layout shader**

```bash
cp registry/graph/layout.wgsl.ts registry/networktopology/layout.wgsl.ts
```

Edit the file header comment to say `GPUNetworkTopology` (no WGSL logic changes).

- [ ] **Step 2: Write `topology.wgsl.ts`**

Start from `registry/graph/graph.wgsl.ts` and change bindings/params:

**Shared uniforms:**

```wgsl
struct TopologyParams {
  nodeSizePx: f32,
  edgeWidthPx: f32,
  selectedNode: i32,
  time: f32,
  pulseSpeed: f32,
}
```

**NODE_WGSL bindings:** `viewport`, `params`, `positions`, `kind` (packed u32 words like graph category), `status` (packed u32 words).

- Size from kind: region `*1.8`, az `*1.5`, service `*1.2`, pod `*1.0`, host `*1.1`
- Tint from kind palette; then mix amber if status==degraded, red+lower alpha if down
- Selected enlarges + brightens (no hover binding)

**EDGE_WGSL bindings:** `viewport`, `params`, `positions`, `edges`, `edgeHealth` (`array<f32>`), `edgeTraffic` (`array<f32>`).

Vertex: same thick-line expansion as graph, but:

```wgsl
let traffic = edgeTraffic[instanceIndex];
let half = max(params.edgeWidthPx * (0.6 + traffic * 1.8), 1.0) * 0.5;
```

Pass `@location`s: `along` (0..1), `health`, `traffic`.

Fragment:

```wgsl
// health 1 → green, 0.5 → amber, 0 → red
let healthy = vec3f(0.35, 0.75, 0.45);
let mid = vec3f(0.90, 0.70, 0.30);
let sick = vec3f(0.90, 0.35, 0.30);
var color = mix(sick, mid, smoothstep(0.0, 0.5, health));
color = mix(color, healthy, smoothstep(0.5, 1.0, health));
let pulse = fract(along + params.time * params.pulseSpeed * max(traffic, 0.05));
let glow = smoothstep(0.55, 0.75, pulse) * (0.25 + 0.75 * traffic);
color = mix(color, vec3f(1.0), glow * 0.45);
let alpha = 0.35 + 0.45 * traffic;
return vec4f(color, alpha);
```

For `down`-looking links (`health < 0.15`), skip glow (`glow = 0`).

- [ ] **Step 3: Smoke-check TypeScript still parses**

No unit test for WGSL strings alone; proceed to Task 4. Optionally `npm run typecheck:registry` after Task 4 adds the component.

- [ ] **Step 4: Commit**

```bash
git add registry/networktopology/layout.wgsl.ts registry/networktopology/topology.wgsl.ts
git commit -m "$(cat <<'EOF'
Add force-layout and mesh shaders for GPUNetworkTopology.

EOF
)"
```

---

### Task 4: `NetworkTopologyComponent`

**Files:**
- Create: `registry/networktopology/NetworkTopologyComponent.ts`
- Modify: `registry/networktopology/topology.test.ts` (add component suite)

**Interfaces:**
- Consumes: `TopologyData`, shaders from Tasks 1–3
- Produces: `NetworkTopologyComponent` implementing `GpuComponent<TopologyProps>`
  - Props: `data`, `viewport`, `paused?`, `selectedNode?`, `nodeSizePx?`, `edgeWidthPx?`, `pulseSpeed?`, `time?`
  - `onProgress: ((iterations, settled) => void) | null`
  - `animating`, `hitTest() => null`, plan name `"networktopology"` / compute `"networktopology-layout"`

- [ ] **Step 1: Write failing component tests** (append to `topology.test.ts`)

Mirror `registry/graph/graph.test.ts` patterns with `createMockGpu`:

```ts
describe("NetworkTopologyComponent", () => {
  it("plans layout compute while animating and draws edges then nodes", async () => {
    const { topology } = ingestTopology({
      nodes: [
        { kind: "service", status: "up" },
        { kind: "pod", status: "up" },
      ],
      edges: [{ source: 0, target: 1, health: 1, traffic: 0.8 }],
      seed: 1,
    });
    const { gpu } = await createMockGpu();
    const surfaceTarget = target(gpu, { size: [64, 64] });
    const component = new NetworkTopologyComponent();
    component.create(makeCtx(gpu, surfaceTarget));
    component.update({
      data: topology,
      viewport: VIEWPORT,
      time: 0.25,
      pulseSpeed: 1,
    });
    assert.equal(component.animating, true);
    const plan = component.plan();
    assert.ok(plan.computePasses.some((p) => p.name === "networktopology-layout"));
    assert.equal(plan.renderPasses[0]?.name, "networktopology");
    assert.equal(component.hitTest(), null);
    component.dispose();
  });

  it("stops animating when paused", async () => {
    // update with paused: true → animating false, computePasses empty
  });
});
```

Include `makeCtx` / `VIEWPORT` copies from `registry/graph/graph.test.ts`.

- [ ] **Step 2: Run — expect FAIL** (class missing)

- [ ] **Step 3: Implement component**

Copy `registry/graph/GraphComponent.ts` → `NetworkTopologyComponent.ts`, then apply these diffs:

1. Rename id prefix to `networktopology-`.
2. Extra storages: `kindBuffer`, `statusBuffer`, `edgeHealthBuffer`, `edgeTrafficBuffer` (f32 arrays for health/traffic; packed u32 words for kind/status like category).
3. Extend `TopologyUniforms` / `graphParams` with `time`, `pulseSpeed` (drop `hoveredNode` or keep unused at -1).
4. On upload: write kind/status packs + health/traffic float buffers.
5. `bindAll`: node draw binds kind+status; edge draw binds edges+health+traffic.
6. `update`: set `time: props.time ?? 0`, `pulseSpeed: props.pulseSpeed ?? 1`.
7. Plan compute name `networktopology-layout`; render name `networktopology`.
8. Keep `MAX_ITERATIONS = 600`, `PROGRESS_INTERVAL = 15`, same `DEFAULTS` / warning above `RECOMMENDED_MAX_NODES`.
9. `hitTest` returns `null`.

React will advance `time` each frame while mounted (Task 5) so pulse moves even after settle — when `animating` is false the scheduler may stop; **keep `animating = true` while `pulseSpeed > 0` and not paused**, OR set `dirty = true` from an rAF in the React wrapper by bumping a `time` prop. Prefer: **wrapper drives `time` via rAF and sets `animating` true whenever not paused** so pulse continues after layout settle (spec: continuous pulse on hot links). Concretely in component:

```ts
this.animating = !this.paused; // layout iterations still capped inside iterate()
```

Inside `iterate`, stop dispatching layout after `MAX_ITERATIONS` but keep `animating` true for frames so pulse uniforms update:

```ts
plan(): RenderPlan {
  const computePasses =
    !this.paused && this.iterations < MAX_ITERATIONS
      ? [{ name: "networktopology-layout", dispatch: () => this.iterate(...) }]
      : [];
  this.animating = !this.paused; // pulse / time updates need scheduler ticks
  …
}
```

- [ ] **Step 4: Run topology tests — expect PASS**

```bash
node --experimental-strip-types --import ./registry/timeline/test/register.mjs --test registry/networktopology/topology.test.ts registry/networktopology/generate.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add registry/networktopology/NetworkTopologyComponent.ts registry/networktopology/topology.test.ts
git commit -m "$(cat <<'EOF'
Add NetworkTopologyComponent with pulsed mesh edges.

EOF
)"
```

---

### Task 5: React wrapper + exports + Dawn smoke

**Files:**
- Create: `registry/networktopology/GPUNetworkTopology.tsx`
- Create: `registry/networktopology/index.ts`
- Create: `registry/networktopology/render.pixels.test.ts`

**Interfaces:**
- Consumes: `NetworkTopologyComponent`, `TopologyData`
- Produces: `GPUNetworkTopology`, public barrel exports

- [ ] **Step 1: Implement `GPUNetworkTopology.tsx`**

Adapt `registry/graph/GPUGraph.tsx`:

- Props per spec (`pulseSpeed`, no hover).
- rAF (or `useGpu` frame hook if one exists — otherwise `requestAnimationFrame`) updates local `time` state passed into the component props while not paused.
- Schematic labels: if `data.nodeCount <= 500`, build up to 100 `LabelOverlay` entries for region/az/service nodes only (kind ≤ service), using **seed positions** (honest approximation — labels will drift as layout moves; footnote in demo). If that feels too wrong, ship **no LabelOverlay in v1** and only a11y summary — prefer **no labels in v1** to avoid lying about GPU positions (spec allows capped overlay in schematic; if positions are GPU-only, **skip LabelOverlay** and document in demo footnote). **Decision locked in plan: skip LabelOverlay in v1** (GPU positions); a11y summary only.
- A11y summary includes node/edge counts + status tallies + settling text.

- [ ] **Step 2: Write `index.ts`**

```ts
export { ingestTopology, KIND, STATUS, POSITION_STRIDE, EDGE_STRIDE, RECOMMENDED_MAX_NODES } from "./ingest.ts";
export type { TopologyData, TopologyInput, RawTopologyNode, RawTopologyEdge, NodeKind, NodeStatus } from "./ingest.ts";
export { generateMesh } from "./generate.ts";
export { NetworkTopologyComponent } from "./NetworkTopologyComponent.ts";
export type { TopologyProps } from "./NetworkTopologyComponent.ts";
export { GPUNetworkTopology } from "./GPUNetworkTopology.tsx";
export type { GPUNetworkTopologyProps } from "./GPUNetworkTopology.tsx";
```

- [ ] **Step 3: Dawn pixel test**

Copy `registry/graph/render.pixels.test.ts` structure; use a tiny `ingestTopology` fixture; after create/update, run several `frame` loops dispatching compute+render; assert painted pixels > 20. Skip if Dawn missing.

- [ ] **Step 4: Run**

```bash
node --experimental-strip-types --import ./registry/timeline/test/register.mjs --test registry/networktopology/*.test.ts
npm run typecheck:registry
```

Expected: all pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add registry/networktopology/
git commit -m "$(cat <<'EOF'
Add GPUNetworkTopology React wrapper and Dawn smoke test.

EOF
)"
```

---

### Task 6: Site wiring (no CLI)

**Files:**
- Modify: `package.json` (`test:registry` glob)
- Create: `apps/site/src/components/demos/NetworkTopologyDemo.tsx`
- Create: `apps/site/app/playground/networktopology/page.tsx`
- Modify: `apps/site/app/playground/page.tsx` (card + count 12)
- Modify: `apps/site/app/components/page.tsx` — `GPUNetworkTopology` tag `later` → `p7`

**Do not modify:** `packages/cli/scripts/buildRegistry.mjs`

- [ ] **Step 1: Extend `test:registry`**

Append `registry/networktopology/*.test.ts` to the existing `--test` argument list in root `package.json`.

- [ ] **Step 2: Demo**

`NetworkTopologyDemo.tsx`:

- `Segmented` for `schematic` | `stress`
- `generateMesh({ mode, seed: 0x7e55 })` in `useMemo` keyed by mode
- Pause toggle via `Btn` / `Segmented`
- Viewport bounds `[-4,4]` like graph; `useMeasuredStage`
- Readout: iterations / settled / node+edge counts
- Legend text: up / degraded / down; hot links pulse
- Footnote: force layout is GPU-resident; known browser animation defect may still apply; not in CLI registry yet

- [ ] **Step 3: Playground page + index card**

Page metadata/title like histogram/depgraph. Index blurb:

- name: `GPUNetworkTopology`
- slug: `networktopology`
- blurb: force-laid service mesh with status, link health, and traffic pulse
- note: playground-only until the shared force-layout animation defect is fixed

Bump live demo count copy from 11 → 12.

- [ ] **Step 4: Matrix tag → `p7`**

- [ ] **Step 5: Verify**

```bash
npm run typecheck --workspace=apps/site
node --experimental-strip-types --import ./registry/timeline/test/register.mjs --test registry/networktopology/*.test.ts
```

Open `/playground/networktopology` and note whether nodes move (document in commit body if still broken).

- [ ] **Step 6: Commit**

```bash
git add package.json apps/site/src/components/demos/NetworkTopologyDemo.tsx \
  apps/site/app/playground/networktopology/ apps/site/app/playground/page.tsx \
  apps/site/app/components/page.tsx
git commit -m "$(cat <<'EOF'
Wire GPUNetworkTopology playground demo without CLI registry.

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Infra mesh schematic | 2, 6 |
| GPU force layout settle | 3, 4 |
| Local fork, no CLI | 3–6 (explicit omit) |
| Kind/status/health/pulse | 1, 3, 4 |
| Dual schematic/stress | 2, 6 |
| No core changes | all |
| No hover / hitTest null | 4, 5 |
| Tests + Dawn | 1, 2, 4, 5 |
| Matrix p7 + playground | 6 |

## Placeholder / consistency review

- Types use `TopologyData` / `ingestTopology` / `generateMesh` / `NetworkTopologyComponent` / `GPUNetworkTopology` consistently.
- Compute pass name `networktopology-layout`; render `networktopology`.
- LabelOverlay deferred in v1 (GPU positions) — matches honest hover stance; demo footnote explains.

---
