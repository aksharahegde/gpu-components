# Handoff

**Last updated:** 2026-08-31 · **Head:** `c1cf471` · **Branch:** `main` (clean) · **Tests:** 381 passing

Read `PLAN.md` for *why* anything is the way it is — it is the governing document and every component
commit reconciles against it. This file is the operational "start here" note: state, commands, the
traps, and what is actually left.

---

## 1. Where things stand

Eight components exist; seven ship through the CLI registry. The runtime (`packages/core`) is proven
across all of them — the §29 architecture question ("can core host a component it was not designed
around?") has been answered yes repeatedly, with the gaps it did find recorded in `PLAN.md`.

| Component | §6.2 score | What it exists to prove | Registry |
|---|---:|---|:--:|
| `GPUTimeline` | 147.0 | The first component; the runtime was designed against it | ✅ |
| `GPUScatter` | 136.0 | 250k points, one draw call. Disproved §9.5's picking claim | ✅ |
| `GPUHeatmap` | 131.0 | The architecture test. Found 2 core gaps | ✅ |
| `GPUDataGrid` | 129.5 | The flagship, built on primitives others paid for. 0 core changes | ✅ |
| `GPUImageDiff` | 120.5 | Real textures, samplers, `maxTextureDimension2D` | ✅ |
| `GPULogViewer` | 119.5 | First dataset with a **tail**. Introduced `RingBuffer` | ✅ |
| `GPUCandlestick` | 119.0 | Acceptance test for `RingBuffer`. Found `overwrite` | ✅ |
| `GPUGraph` | 118.0 | Force layout, the only animating component | ❌ **defect** |

**Test counts:** core 97 · react 10 · cli 30 · bench 11 · registry 233 = **381**.

### Primitive health — the metric that has been driving component choice

A primitive with one consumer is unproven: it may just be that consumer's internals in another file.
This table is how the last two components were chosen, and it is worth keeping current.

| Primitive | Consumers |
|---|---|
| `RasterLayer` | 4 — timeline, heatmap, grid, imagediff |
| `InstancedQuadLayer` | 3 — timeline, scatter, graph |
| `LineLayer` | 3 — timeline, scatter, grid |
| `RingBuffer` | 2 — logviewer, candlestick *(proven 2026-08-31)* |
| `createImageTexture` | **1** — imagediff *(unproven)* |

`createImageTexture` is now the only single-consumer primitive. If the next component is chosen on
this basis, it should be one that needs real textures independently.

---

## 2. Commands

```bash
npm test                 # everything. Runs build:packages first via pretest
npm run typecheck        # workspaces + registry
npm run test:registry    # component tests only (includes real-Dawn pixel tests)
npm run build:packages   # core + react only

# One component, fastest loop:
node --experimental-strip-types --import ./registry/timeline/test/register.mjs \
  --test registry/<name>/*.test.ts

# Regenerate the CLI registry after adding/changing a component (never hand-edit registry.json):
node packages/cli/scripts/buildRegistry.mjs

# Benchmarks / spikes (real Chromium via Playwright, run deliberately — not in npm test):
cd apps/bench && npx playwright test tests/logTextOnly.spec.ts --reporter=line
```

The site dev server is expected at **http://localhost:3000**. Playground pages live at
`/playground/<slug>`.

> **Do not run the root `npm run build`.** It runs `apps/site`'s `next build`, which corrupts a
> running dev server. Use `build:packages`.

---

## 3. Repo map

```
packages/core       the runtime: scheduler, layers, viewport, budget, ring buffer, passes
packages/react      GPUProvider, useGpuComponent, useGpuA11y
packages/testing    createMockGpu / createMockRuntime (vgpu/mock)
packages/cli        gpu-components add|diff|doctor|list + generated registry.json
packages/wgsl       empty stub
registry/<name>/    one folder per component — ingest, *.wgsl.ts, Component, GPU*.tsx, tests
apps/site           Next.js site + playground (one page per component)
apps/bench          Playwright benchmark + spike harness
spikes/*.md         measurement write-ups that gated real decisions
PLAN.md             governing document, §-numbered, reconciled by every component commit
CHANGELOG.md        STALE — last entry 2026-08-29, does not cover the last seven commits
```

---

## 4. Traps — read this before writing code

These all cost real time. Most are recorded at their site in the code as well.

### The big one: **a green test suite does not mean it renders**

Four components have shipped defects that 100% passing tests could not see, and every one was obvious
in a browser within seconds. **Always open the playground page and look**, and check the console.

Recent examples: `push(...arr)` overflowing the stack at 200k elements (tests used 3k); an overview
strip painting a quad thousands of pixels tall over the whole chart; a readback racing the compute
that produced it and returning an empty buffer.

### GPU / WGSL

- **Never put a backtick inside a `/* wgsl */` template literal.** It terminates the string and the
  error points at a comment. This happened *four* times. Now guarded by
  `packages/core/src/wgslSyntax.test.ts`.
- **Order readbacks on the GPU queue, not by wall clock.** Call `.read()` immediately after the
  dispatch that produces the data. A `setTimeout` "wait for the frame" loses the race and silently
  returns pre-dispatch contents. See `CandlestickComponent.dispatchOverview`.
- **WGSL atomics are integer-only.** For float min/max, `bitcast<u32>` is order-preserving *only for
  positive floats* — the sign bit inverts ordering. Validate at ingest (`validateBars`).
- **Reset atomic buffers to the right sentinel.** `atomicMin` needs `0xffffffff`, not 0. Zeroing a
  min-bucket pins it at 0 forever.
- `self` and `from` are reserved WGSL keywords. Dawn rejects them; the mock does not.
- Uniform structs need 16-byte alignment. Pad explicitly and keep the JS key order identical.
- A fragment shader that may `discard` cannot use implicit derivatives — use `textureSampleLevel`.

### Precision & JS limits

- **Store timestamps relative to an epoch, in seconds.** f32 has ~24 bits of mantissa, so absolute
  epoch milliseconds quantise to ~131-second steps and every record collapses onto one timestamp.
- **Never `arr.push(...bigArray)`.** Spread passes each element as an argument; it overflows the
  stack somewhere around 65k. Use a loop.
- Typed arrays passed to GPU APIs need `<ArrayBuffer>`, not the default `<ArrayBufferLike>` —
  annotate as `Uint8Array<ArrayBuffer>` / `Float32Array<ArrayBuffer>`.

### vgpu

- **Its public types under-declare its implementation.** `StorageBuffer` declares `write(data)` and no
  `destroy()`; the object `storage()` actually returns is `RingStorageBuffer`, which has
  `write(data, offset?)` and `destroy()` marked `@internal`. That assumption is isolated to
  `packages/core/src/ringBuffer.ts` per §30 risk 3 — keep it there.
- **Do not probe capability with `Function.length`.** It stops counting at the first optional
  parameter, so `write(data, offset?)` reports 1 on the class that supports it. Verify behaviourally
  with a real-Dawn test instead.
- `sampler()` is cached by descriptor. vgpu has **no** texture-from-pixels helper — that is ours
  (`createImageTexture`).

### Tooling

- Node's `--experimental-strip-types` requires **explicit `.ts` import specifiers** everywhere.
- **Rebuild `packages/*` before running registry tests** or you debug a stale `dist/`. `pretest` does
  this; a bare `node --test` does not.
- The mock GPU has no browser globals (`GPUTextureUsage` etc.). Spell out spec constants.
- Watch out for persisted `cd` in the shell — it has caused writes to the wrong directory twice.

---

## 5. Open work

Ranked by my read of value. Items 1–3 are all "the plan promises something the code does not do",
which is worth more than a ninth component.

### 1. `GPUGraph` does not animate in the browser — **open defect**
Renders its seeded layout, then never iterates. `factory`, `create()` and `update()` all run; the
scheduler never calls `plan()`. Deliberately excluded from `registry.json` with a comment in
`packages/cli/scripts/buildRegistry.mjs`, because a copy-source registry must not ship something
broken where users meet it. It is the one shipped component that is visibly wrong.
*Start at:* `registry/graph/GraphComponent.ts` (`animating` flag) and `packages/core/src/scheduler.ts`.

### 2. Canvas2D fallback stages 3–5
`tier: 'fallback'` currently **mounts nothing**, so every component renders blank without WebGPU while
§22.2 documents a policy for it. `PassEncoder`/`CANVAS2D_CAPS` and per-layer fallback policies exist;
nothing dispatches to them. Largest gap between what the plan promises and what the code does.

### 3. The five-minute install claim is unverified
Phase 6's acceptance criterion (§32) requires a scripted e2e test taking a fresh Vite and Next app
from `npm i` to a rendering component. Not written. The CLI itself is tested (30 tests).

### 4. `CHANGELOG.md` is stale
Last entry 2026-08-29; the last seven commits are not in it. Commit messages are detailed and are
currently the real record.

### 5. Not gaps — decisions, do not "fix" them
- **`LabelLayer` / glyph atlas: deliberately unbuilt**, on two measurements
  (`spikes/grid-text-budget.md`, `spikes/log-text-budget.md`). Canvas2D text costs 0.1ms p50 at a
  realistic window and there is no crossover anywhere in either sweep. §12.1 now reads as "three
  primitives and a measured decision". The two triggers that *would* justify it are recorded in the
  log spike: continuously zooming text, and per-glyph styling driven by GPU state.
- **`Picker` (§9.5) has no justified consumer.** Scatter disproved the original case with a CPU
  spatial index. `GPUGraph` is the one component that genuinely cannot hit-test on the CPU, and its
  wrapper says so rather than pretending to offer hover.

---

## 6. Adding a component — the established shape

1. **Choose it for a reason and write the reason down.** The last three were chosen to force a
   specific untested surface (textures, streaming, then proving `RingBuffer`), not for coverage.
2. **If it hinges on a performance assumption, measure first.** Add a scenario to `apps/bench`, run it
   in real Chromium, and write up `spikes/<name>.md` — including results that contradict the plan.
   Two spikes have now overturned a planned deliverable.
3. Build `registry/<name>/`: `ingest.ts` · `<name>.wgsl.ts` · `<Name>Component.ts` · `GPU<Name>.tsx` ·
   `index.ts`, plus `<name>.test.ts` (mock GPU) and `render.pixels.test.ts` (real Dawn).
4. **Pixel tests must assert what only this component can get wrong** — ring wrap addressing, texture
   orientation, in-place overwrite landing on the right slot. "A quad appeared" proves nothing.
5. Add the test glob to root `package.json` → `test:registry`.
6. Demo at `apps/site/src/components/demos/<Name>Demo.tsx`, page at
   `apps/site/app/playground/<slug>/page.tsx`, card in `apps/site/app/playground/page.tsx`.
7. Add to `ITEMS` in `packages/cli/scripts/buildRegistry.mjs` and regenerate.
8. **Open the page in a browser and look at it.** Check the console.
9. Reconcile `PLAN.md`: a status note under Phase 7, plus edits to any § the work contradicted.

### Honesty rules that have held up
- State what is *not* on the GPU and why (§5.2). Several components do CPU work deliberately — the
  grid's and log's text, the candlestick's visible price range — and say so.
- Do not lead with a throughput claim a component cannot support (§8.1). The grid, log viewer and
  candlestick all have weak draw-call stories and the docs say so.
- Readbacks are allowed only per-data-change, never per-frame, and each one carries a comment
  justifying itself against §5 gate 4.
