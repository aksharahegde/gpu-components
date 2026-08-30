# GPU Component Runtime — Project Plan

**Working name:** `gpu-components` · **Runtime layer:** [vgpu](https://vgpu.sh) (`vercel-labs/vgpu`) · **Status:** pre-implementation
**Date:** 2026-08-29 · **Audience:** a senior engineer who will implement this without re-deriving the architecture

> Research basis: the vgpu API surface in this document was read from the canonical vgpu docs corpus
> (`https://vgpu.sh/llms-full.txt`, ~17.4k lines, and the vgpu MCP docs server). Every vgpu symbol used
> below is quoted from that corpus. Nothing is invented. Where vgpu does **not** provide something, this
> document says so explicitly and assigns the responsibility to us.

---

## 1. Executive Summary

The GPU-accelerated web component space in 2026 has a runtime-shaped hole in it, not a component-shaped one.

WebGPU reached Baseline in January 2026 (Chrome/Edge since 113, Safari 26+, Firefox 141+ on Windows and 145+ on macOS Tahoe ARM). The first wave of WebGPU component libraries has already shipped — ChartGPU and its shadcn-installable wrapper `chartcn` (Jan 2026) — and they are *charts*. What none of them have is the thing that makes a component *library* rather than a component: a shared GPU runtime, so that a page with a timeline, a heatmap and a grid on it holds **one** `GPUDevice`, **one** frame loop, **one** command submit, one pipeline cache, and one honest accessibility story.

This project builds that runtime, and proves it with a component whose GPU requirement is not arguable.

**What we build:**

1. `@gpu-components/core` — a framework-independent GPU runtime over vgpu: one device, a frame scheduler that encodes every mounted component into a single `frame(gpu, …)` per tick, a resource registry with deterministic disposal, a capability/fallback gate, and a profiler built only on metrics WebGPU actually exposes.
2. `@gpu-components/react` — a thin adapter (`<GPUProvider>`, `useGpuCanvas`, `useGpuComponent`). React never owns GPU state.
3. **`GPUTimeline`** — the first component: a trace/event/span timeline that stays interactive at 1M–10M spans.
4. A shadcn-style registry CLI that copies **component source + WGSL** into the user's repo, while the runtime stays a versioned npm dependency.

**The MVP recommendation challenges the stated hypothesis.** The hypothesis was DataGrid → runtime → Graph. This plan recommends **runtime → Timeline → Heatmap (as the architecture test) → DataGrid → Scatter/Graph**. The reasoning is in §7–8: the DataGrid is the right *flagship*, but the wrong *first*, because it is the component where the GPU advantage is weakest (its render cost is glyph rasterization, not fill rate) and the implementation cost is highest (text is the hardest problem in GPU UI, and vgpu supplies none of it). The Timeline has an airtight GPU story, bounded text requirements, and it produces — as a byproduct — the exact primitives (instanced quads, viewport transform, LOD binning, picking, glyph atlas, semantic overlay) that the DataGrid needs in phase 5.

**Success is measured as:** one device across N components on a page; ≥60fps sustained pan/zoom over 5M spans on a mid-range 2023 laptop GPU; sub-16ms hover latency; zero GPU resource leaks across mount/unmount cycles verified in `vgpu/mock`; and a keyboard-and-screen-reader-navigable timeline. If the runtime cannot carry the second component without modification, the architecture failed regardless of frame times.

---

## 2. Product Thesis

> Application developers should be able to put a GPU-class data surface in a React app the same way they put a button in it — and the GPU should be an implementation detail they can read, fork, and delete.

Three convictions follow from that:

**(a) The unit of value is the runtime, not the component.** A single WebGPU chart is a weekend project on top of vgpu. A page that hosts six GPU surfaces without six devices, six render loops, six pipeline caches and six `requestAnimationFrame` callbacks is an engineering project. Libraries that ship components without a runtime force the runtime problem onto every consumer, and consumers solve it badly (or ship six devices — browsers cap concurrent devices, and each costs memory and driver state).

**(b) GPU is a means, and the docs must say when it isn't.** Every component in this library ships a "When NOT to use this" section with a numeric crossover point measured on our own benchmark harness. A library that teaches developers to reach for the GPU at 500 rows is a worse library than one that tells them to use a `<table>`.

**(c) Accessibility is architectural, not a follow-up.** A canvas is an opaque pixel buffer to assistive technology. Any GPU UI library that treats a11y as a v2 concern will find it is not retrofittable, because the semantic model has to be the *same* model the renderer draws from. We build the semantic overlay in phase 2, alongside the first component, from the same view-model.

---

## 3. Problem Statement

### 3.1 The concrete failures we are addressing

| Workload | What developers use today | Where it breaks | Why |
|---|---|---|---|
| Trace / span timelines (profilers, OTLP traces, LLM agent traces, CI, network waterfalls) | Hand-rolled Canvas2D, or embed Perfetto | ~50k–200k spans; zoom/pan drops to 10–20fps | Canvas2D issues one `fillRect` + state change per span on the CPU; there is no batching primitive |
| Dense scatter / point layers | deck.gl (WebGL2), Plotly | ~1M points, and re-render on every colour/filter change | Filter and colour mapping happen on CPU, forcing a full buffer re-upload |
| Data grids with computed formatting | AG Grid (DOM), glide-data-grid (Canvas2D) | DOM: ~5k rows. Canvas2D: scrolls fine to millions, but per-cell computed styling, cell sparklines, and full-dataset sort/filter/aggregate stall | Grid render cost is glyph raster (bounded by viewport); grid *data* cost is unbounded |
| Large graphs | cosmos.gl / Cosmograph (WebGL2), sigma.js | Works well, but WebGL2-only and app-shaped not component-shaped | Layout is a GPU-shaped problem already solved in WebGL |

### 3.2 The runtime failure, which is the one nobody is solving

Put a WebGPU chart library and a WebGPU map on the same page today and you get two `navigator.gpu.requestAdapter()` calls, two devices, two pipeline caches, two rAF loops competing for the same 16.6ms, and no way for one to sample the other's output. Nothing composes. There is no shared `sampler`, no shared colormap texture, no shared glyph atlas, no shared frame budget, and no single place to answer "why did this frame take 22ms".

**That is the product gap.** Not "charts, but faster".

### 3.3 The constraint everyone underestimates

WebGPU has **no text rendering**. vgpu has none either — a full-text scan of the vgpu documentation corpus returns zero occurrences of `font`, `msdf`, or `text render`. Every data component that matters is text-dense. Any credible plan here has to have an explicit, staged answer for text, and has to pick a first component whose text budget is small enough that the answer can be staged. This plan does (§13.4, §21).

---

## 4. Competitive Landscape

Assessed for: what it does well, what it does poorly, GPU usage, rendering architecture, component model, extensibility, DX, performance, licence, and where we differentiate.

### 4.1 Direct — WebGPU component libraries

**ChartGPU + chartcn** (2026, open source). *The closest thing to a competitor.* WebGPU-native charting (line/area/bar/scatter/pie/candlestick), claims 1M points at >100fps; `chartgpu-react` bindings; `chartcn` wraps it in a shadcn-CLI-installable registry with a PixiJS+WebGL fallback path as an alternate base.
- **Does well:** proves the market and the distribution model; genuinely fast; good chart-type coverage; the shadcn registry choice is correct and we should follow it.
- **Does poorly / where we differentiate:** it is a *chart* library, so there is no cross-component runtime — no shared device contract across a page of heterogeneous components. No compute stage in the data path (filtering and aggregation stay on CPU). ChartGPU proper ships **no WebGL/Canvas fallback** and gates unsupported browsers to the host app; `chartcn` solves that by swapping in an entirely different renderer (PixiJS), which means two implementations to maintain per component. Accessibility is asserted at the API level, not architected as a semantic overlay. And it does not attempt the hard categories: no grid, no timeline, no trace viewer.
- **Conclusion:** do not build charts. Build the runtime and the categories they cannot reach from a chart abstraction.

### 4.2 GPU rendering frameworks (the layer *below* us — collaborators, not competitors)

**Three.js / React Three Fiber (MIT).** The reference for "renderer + framework adapter". R3F's real lesson is its reconciler: declarative children mapping to a retained scene graph, with `useFrame` as the imperative escape hatch, and a hard rule that React state changes must not churn GPU resources. Its weakness for us is that its whole model is a 3D scene graph — hierarchical transforms, materials, lights — which is the wrong abstraction for 2D data surfaces where there is one viewport and no hierarchy. **Take:** the adapter pattern and `useFrame`. **Leave:** the scene graph. *(Note: vgpu already ships `vgpu/scene` with `mesh`/`group`/cameras/materials/`orbitControls` — we must not rebuild it, and we should not use it for 2D data components either.)*

**PixiJS (MIT).** Best-in-class 2D batching; v8 has a WebGPU renderer with WebGL fallback. Its batcher is the thing to study: sprite/quad batching with texture-array binding. Weakness: display-list/scene-graph object model with per-node JS objects — at 1M spans the JS object graph is itself the bottleneck. **Take:** batching strategy. **Leave:** one JS object per drawable.

**regl (MIT).** Stateless functional WebGL command model — the intellectual ancestor of "declare a draw, execute it". vgpu's `draw(gpu, {...})` / `.draw(target)` is recognisably in this lineage. WebGL1-era, unmaintained. **Take:** the "commands are values" idea, already inherited via vgpu.

**deck.gl / luma.gl / vis.gl (MIT, Linux Foundation).** The most sophisticated layer model in the space: `Layer` lifecycle (`initializeState`/`updateState`/`draw`/`finalizeState`), attribute managers with partial-update tracking, GPU picking via an ID colour buffer, transitions, and composite layers. **Its WebGPU port is still incomplete in 2026** — luma.gl v9 has experimental WebGPU; deck.gl states WebGPU is "a work in progress and not production ready", with shader modules and layers being ported incrementally. **This is the single biggest timing signal in this analysis:** the strongest layer architecture in web GPU dataviz has not landed on WebGPU yet. **Take:** the layer lifecycle (heavily — our component lifecycle in §9.4 is a deliberately simplified deck.gl `Layer`), the attribute-update model, and the ID-buffer picking design. **Leave:** the geospatial coupling, the viewport zoo, and the size (deck.gl is ~500KB+).

**MapLibre GL JS (BSD-3).** Tile pipeline, worker-side geometry preparation, and — critically for us — its **glyph atlas / SDF text stack**, which is the most battle-tested open-source answer to "text on the GPU in a browser". **Take:** the SDF glyph-atlas design when we get to phase 4 text. **Leave:** everything map-shaped.

### 4.3 Component libraries in the target categories (the incumbents to beat or avoid)

**AG Grid (dual: MIT community / commercial enterprise).** The market leader. DOM-based with row/column virtualisation; enormous feature surface (grouping, pivot, aggregation, editing, Excel export). Falls over on very wide grids and rich per-cell rendering; enterprise features are paid. *We do not compete with its feature surface and should say so in our docs.*

**TanStack Table (MIT).** Headless — the model we should emulate for the *state* half of a grid. It computes rows/columns/sorting/filtering and renders nothing. **A GPUDataGrid should ideally be a TanStack Table renderer, not a Table replacement.** That is a strong differentiation and a strong adoption story for phase 5.

**glide-data-grid (MIT).** Canvas2D React grid, millions of rows, damage-based repaint, real accessibility work, rich cell types. **This is the honest bar for a GPU grid**, and it is high. It proves that at *viewport* scale, Canvas2D is sufficient for scrolling. This is the primary evidence for demoting DataGrid out of the MVP slot (§8).

**Apache ECharts (Apache-2.0).** Canvas2D + optional WebGL (`echarts-gl`) for large scatter. Huge chart vocabulary, mediocre TypeScript ergonomics, monolithic bundle, imperative `setOption` API. Not a runtime.

**Perfetto UI (Apache-2.0).** The state of the art for trace viewing — Canvas2D front-end over a WASM/SQLite trace processor, and *years* of engineering. It is an application, not an embeddable component; embedding it means embedding a whole app. **There is no embeddable, WebGPU, framework-native timeline component.** That is the wedge.

**cosmos.gl / Cosmograph (MIT).** GPU force-directed layout and rendering entirely in WebGL shaders; genuinely handles ~1M nodes. Strong, mature, and it means a `GPUGraph` MVP would be entering a solved WebGL market with a WebGPU rewrite — the weakest differentiation of the three hypothesised candidates.

**shadcn/ui (MIT).** Not a competitor; a distribution model. Its lesson is that for code developers *must* customise — and shaders and render policy are exactly that — ownership beats configuration. Its counter-lesson is that "you own the code" also means "you own the bugs and get no upgrades", which is why our runtime stays an npm package (§18).

### 4.4 The gap, stated precisely

> Nobody is building a **shared, framework-independent WebGPU runtime for heterogeneous application components**, with **compute in the data path**, an **architectural accessibility model**, and a first component in a **category no GPU library currently serves** (dense interactive timelines / trace surfaces).

---

## 5. GPU Opportunity Analysis

The screening questions from the brief, applied as a gate. A component category passes only if it clears all six.

1. **Does the workload exceed what one CPU frame can touch?** The DOM/Canvas2D ceiling is roughly *the number of primitives you can issue per frame from JS*: ~5k DOM nodes, ~50k Canvas2D `fillRect`s at 60fps. GPU instancing changes the unit from "one JS call per primitive" to "one JS call per *million* primitives".
2. **Is there per-element work that is data-parallel?** Colour mapping, thresholding, normalisation, projection, LOD bucketing, min/max reduction.
3. **Does interaction require re-deriving the whole dataset?** Zoom/pan/brush/filter over an immutable dataset is the ideal GPU case: upload once, re-render from a changed uniform. CPU pipelines re-walk the data.
4. **Can we avoid CPU↔GPU round-trips?** Anything needing a synchronous readback per frame is disqualified. (vgpu is explicit: `target.read()` / `StorageBuffer.read()` are "for tests, snapshots, and diagnostics", *not* a hot path. Indirect draws/dispatches exist precisely so counts stay on the GPU.)
5. **Is the text budget bounded?** Text is the tax. If a component needs >1k glyph runs per frame, we must have built the glyph atlas first.
6. **Does it produce reusable runtime primitives?** A component that needs a bespoke pipeline nobody else reuses is a demo, not a library investment.

### 5.1 What belongs on the GPU, in general

- Instanced primitive rendering (quads, lines, points) with per-instance attributes in a storage buffer.
- Viewport transform (a single uniform; pan/zoom becomes a uniform write, not a data re-walk).
- Colour mapping / normalisation / thresholding (fragment or compute).
- LOD & density binning: reducing N elements to one value per pixel column/tile (compute + atomics).
- Reductions: min/max/sum/count for auto-ranging axes and histograms.
- Selection masks: a bitset in a storage buffer, so "highlight the 40k selected rows" is a shader branch, not a JS loop.
- ID-buffer picking for layers where CPU spatial indexing is impractical.

### 5.2 What must **not** move to the GPU

- **String handling of any kind.** Formatting, search, comparison, collation. Stays CPU/worker.
- **Parsing and one-time sorting.** Do it once at ingest in a worker; do not re-sort per frame.
- **Layout of tracks/rows/columns.** Small-N, branchy, and the a11y model needs it on CPU anyway.
- **Anything requiring a synchronous answer this frame** (tooltip contents, exact hit result). Use CPU spatial indices or accept one-frame-late GPU picking.
- **Small datasets.** Below the crossover (to be measured, hypothesised at 20k–50k primitives) the GPU path is slower end-to-end because of upload and pipeline overhead, and the docs must say so.

---

## 6. Candidate Component Matrix

18 categories brainstormed, scored 1–10 on eight axes, weighted. Weights encode this project's priorities: we are building a *runtime* first, so "reusable primitives" and "GPU necessity" are weighted above raw market size.

**Weights:** GPU necessity ×3 · Reusable primitives ×3 · Real-world usefulness ×2.5 · Differentiation ×2.5 · Feasibility (inverse complexity) ×2 · Demonstrable perf delta ×2 · Adoption potential ×1.5 · Browser/fallback risk ×1 *(scored so 10 = low risk)*

| # | Candidate | GPU need | Reuse | Useful | Diff | Feas | Perf demo | Adopt | Fallback | **Weighted** |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **GPUTimeline** (trace/span/event) | 9 | 9 | 9 | 9 | 7 | 9 | 8 | 7 | **147.0** |
| 2 | **GPUScatter / point layer** | 9 | 8 | 8 | 5 | 9 | 10 | 7 | 8 | **136.0** |
| 3 | **GPUHeatmap / matrix** | 8 | 7 | 8 | 6 | 9 | 9 | 7 | 8 | **131.0** |
| 4 | **GPUDataGrid** | 6 | 8 | 10 | 9 | 4 | 6 | 10 | 6 | **129.5** |
| 5 | GPUGraph (force layout) | 9 | 6 | 7 | 4 | 5 | 9 | 7 | 6 | **118.0** |
| 6 | GPU log/stream viewer | 6 | 7 | 9 | 8 | 5 | 6 | 8 | 6 | **119.5** |
| 7 | GPU candlestick / financial series | 8 | 6 | 8 | 3 | 8 | 9 | 7 | 8 | **119.0** |
| 8 | GPU histogram / distribution | 7 | 6 | 7 | 4 | 9 | 8 | 6 | 8 | **112.5** |
| 9 | GPU flame graph (profiles) | 8 | 8 | 8 | 8 | 7 | 8 | 7 | 7 | **139.0** *(near-duplicate of #1 — same primitives; treat as a Timeline variant)* |
| 10 | GPU image diff / large-image viewer | 9 | 5 | 7 | 6 | 8 | 9 | 6 | 8 | **120.5** |
| 11 | GPU annotation canvas (image + overlays) | 6 | 5 | 7 | 5 | 7 | 6 | 6 | 7 | **99.0** |
| 12 | GPU density / geospatial point map | 9 | 6 | 8 | 3 | 5 | 9 | 6 | 7 | **114.5** |
| 13 | GPU node / flow editor | 4 | 6 | 8 | 5 | 5 | 4 | 8 | 6 | **97.0** |
| 14 | GPU whiteboard / infinite canvas | 5 | 6 | 7 | 4 | 5 | 5 | 7 | 6 | **95.0** |
| 15 | GPU PDF / document viewer | 5 | 4 | 8 | 7 | 3 | 5 | 7 | 5 | **92.5** |
| 16 | GPU dependency / repo graph | 7 | 5 | 7 | 6 | 5 | 7 | 7 | 6 | **110.0** |
| 17 | GPU network topology | 7 | 5 | 6 | 5 | 5 | 7 | 5 | 6 | **102.0** |
| 18 | GPU spreadsheet (formula engine on GPU) | 5 | 5 | 8 | 9 | 2 | 5 | 7 | 5 | **97.5** |

### 6.1 Rejected outright (fail the §5 gate)

Particle backgrounds, shader wallpapers, "animated ball" demos, decorative post-processing, 3D scene viewers, generic mesh viewers. All fail gate 1 (no data-scale problem) or gate 6 (no reusable primitive that another *application* component needs). `vgpu/scene` already covers 3D mesh rendering and we should not duplicate it.

### 6.2 Top 3

1. **GPUTimeline** (with flame graph as a same-primitives variant) — 147.0
2. **GPUScatter / dense point layer** — 136.0
3. **GPUHeatmap / matrix** — 131.0, with **GPUDataGrid** at 129.5 as the strategic flagship

*Note on the scoring:* GPUDataGrid scores highest on usefulness (10) and adoption (10) and *loses* on feasibility (4) and demonstrable perf delta (6). That is not an accident of weighting — it is the core finding of this analysis, and §8 explains it.
---

## 7. Recommended MVP

> **Build the runtime, and prove it with `GPUTimeline`. Ship `GPUDataGrid` second, in phase 5, on primitives the Timeline already paid for.**

The MVP is two things delivered together, because neither is credible alone:

**MVP-A — `@gpu-components/core` + `@gpu-components/react`**
One `Gpu` per provider. One frame per rAF tick containing every mounted component's passes. Deterministic resource lifecycle with leak assertions. Capability gate + fallback contract. A profiler restricted to metrics WebGPU actually exposes.

**MVP-B — `GPUTimeline`**
A trace/span/event timeline: N tracks × M spans, pan/zoom/brush, hover and selection, span labels, keyboard navigation, and a screen-reader-navigable semantic model. Target: **5M spans, 60fps sustained pan/zoom, <16ms hover latency**, on a 2023 mid-range integrated/discrete GPU.

**Explicitly not in the MVP:** charts of any kind, 3D, a graph layout engine, a component marketplace, Vue/Svelte adapters, a GPU text engine beyond the bounded label path, and any component that is not the Timeline.

---

## 8. Why This Component (and why not the hypothesised one)

### 8.1 Why the hypothesis was right about #2 and wrong about the order of #1 and #3

The stated hypothesis was **1) GPUDataGrid, 2) GPUCanvas/rendering runtime, 3) GPUGraph**.

**#2 is correct and should be #1.** The runtime is the product. Everything below agrees with that instinct.

**GPUDataGrid is the right flagship and the wrong first build.** Three reasons, in order of severity:

1. **Its GPU advantage is the weakest of any candidate, and the incumbent already proved it.** A grid draws only what is in the viewport — call it 40 columns × 60 rows = 2,400 cells. That is *nothing* for a GPU and it is also, demonstrably, nothing for Canvas2D: glide-data-grid scrolls millions of rows at 60fps on Canvas2D today, with damage-based repaint. The grid's real cost is **glyph rasterisation of ~2,400 strings per frame**, and moving glyph raster to the GPU requires a full glyph-atlas text stack *before you can draw the first cell*. The honest GPU wins in a grid are in the **data** path — full-dataset sort/filter/aggregate, per-cell computed conditional formatting, in-cell sparklines, high-frequency streaming updates — and those wins compete against DuckDB-WASM and Arrow, which are extremely good. Leading with our weakest performance claim against a strong incumbent is a bad opening move.
2. **It front-loads the hardest unsolved problem.** vgpu provides no text (zero hits for `font`/`glyph`/`msdf` across its entire documentation corpus). A grid is ~100% text. Building the runtime *and* a production glyph-atlas text engine *and* the first component simultaneously is how a project spends six months without shipping.
3. **It has the largest correctness surface.** Editing, selection semantics, copy/paste, column resize/reorder, sticky headers, RTL, IME, focus management. Those are grid features, not GPU features, and they will consume the entire schedule.

**GPUGraph is the weakest of the three.** cosmos.gl already does GPU force layout at ~1M nodes in WebGL, well. A WebGPU rewrite of a solved problem is the lowest-differentiation option, force layout is a research rabbit hole with poor determinism (bad for snapshot testing), and it produces the fewest reusable primitives — a specialised layout compute pass that no other component uses.

### 8.2 Why GPUTimeline

**GPU necessity is airtight.** A trace timeline draws *every span in the visible time range*, not a fixed viewport grid. Zoom out on a 5M-span trace and you are asked to draw millions of rectangles in 16ms. Canvas2D issues one `fillRect` + state mutation per span from JS — the CPU ceiling is ~50k/frame. DOM is out at ~5k. This is not a marginal claim; it is a 100× gap, and it is trivially demonstrable in a side-by-side playground.

**The text budget is bounded and that is the whole point.** A span only gets a label if it is wide enough to hold one. At any zoom level, the number of labelled spans is bounded by *screen width / minimum label width* ≈ **200–400 labels**, regardless of dataset size. That is inside DOM-overlay budget — which means **v1 needs no GPU text engine at all**, and the DOM overlay we build for labels *is* the accessibility overlay. Text becomes a phase-4 optimisation instead of a phase-0 blocker. No other candidate has this property.

**It exercises every subsystem the runtime must have, and nothing it doesn't.**

| Runtime subsystem | Forced by the Timeline |
|---|---|
| Instanced quad renderer with per-instance storage buffer | Spans |
| Viewport/transform uniform, pan/zoom without data re-walk | Time axis + track scroll |
| Compute pass, storage buffers, workgroup tuning | LOD density binning |
| Indirect dispatch/draw | Variable visible-span counts without CPU readback |
| Reduction | Auto-range, track min/max, histogram |
| Selection mask buffer | Brush/multi-select over 100k+ spans |
| Async picking + CPU spatial index | Hover/click |
| Multi-pass frame (density → spans → overlay) | Zoomed-out LOD compositing |
| Semantic DOM overlay | Labels *and* a11y, same layer |
| Fallback renderer | Canvas2D quads + labels — a small, honest surface |

**The market is real, growing, and under-served.** Profilers, observability/OTLP trace UIs, CI dashboards, network waterfalls, Gantt at scale, media editors, and — the 2026 growth case — **LLM agent trace viewers**, which essentially every AI-tooling company is currently hand-rolling in Canvas2D. There is no embeddable WebGPU timeline component. Perfetto is an application, not a library.

**It is the correct on-ramp to the DataGrid.** By the end of phase 4, the Timeline has produced: an instanced quad renderer, a viewport system, a selection-mask model, GPU picking, a glyph atlas (phase 4), and a semantic overlay. A `GPUDataGrid` built on those is mostly *grid semantics*, which is where its difficulty actually lives. Building the Timeline is the shortest path to a good DataGrid.

### 8.3 The honest risk of this choice

The Timeline is a *narrower* market than a data grid, and "trace viewer" reads as niche to a casual observer scanning a README. Mitigation: position and document the component as **`GPUTimeline` — spans, events, flame graphs, Gantt, waterfalls** (all the same primitive), lead the README with the LLM-agent-trace and profiler use cases, and state the DataGrid on the public roadmap from day one so the flagship is visible even before it ships.

---

## 9. Architecture

### 9.1 The layer stack, with responsibilities assigned

```text
┌─────────────────────────────────────────────────────────────┐
│ Application                                                  │  user code
├─────────────────────────────────────────────────────────────┤
│ @gpu-components/react     GPUProvider · useGpuCanvas ·      │  ADAPTER ONLY
│                           useGpuComponent · useFrame         │  no GPU state
├─────────────────────────────────────────────────────────────┤
│ components/gpu/timeline/  TimelineComponent · timeline.wgsl  │  COPIED INTO
│  (shadcn-copied source)   view model · a11y model            │  USER'S REPO
├─────────────────────────────────────────────────────────────┤
│ @gpu-components/core      GpuRuntime · FrameScheduler ·      │  OURS, npm
│                           ResourceRegistry · RenderPlan ·    │  framework-free
│                           Capabilities · Profiler · Picker · │
│                           ViewportModel · InstanceBuffer     │
├─────────────────────────────────────────────────────────────┤
│ vgpu                      init · surface · target · draw ·   │  THEIRS
│                           effect · compute · frame · bundle ·│
│                           storage · uniforms · timer · clock │
├─────────────────────────────────────────────────────────────┤
│ WebGPU                                                       │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Responsibility split: vgpu vs. us

This is the most important table in the document. **Anything in the left column we must not reimplement.**

| vgpu already provides (verified in its docs) | We must provide on top |
|---|---|
| `init()` → one `Gpu`; every factory is `gpu`-first, so one device is the default, not a feature | Provider-scoped runtime, ref-counted so N React trees share one `Gpu` |
| `initFromDevice(device)` to adopt an externally-owned device; `device.wrapBuffer(raw)` zero-copy | Interop policy: when to adopt vs. create; documented lifetime rules |
| `surface(gpu, canvas, opts)` — multiple canvases per device, `autoResize`, `dpr` clamp, `onResize` | Canvas registry, DPR policy, resize→viewport→uniform propagation |
| `target(gpu, {size, format, colors, depth, msaa})`, `pingPong`, `read()/readFloats()` | Shared offscreen target pool; a policy that keeps readback off the hot path |
| `draw(gpu, {shader, geometry, instances, vertices, blend, cull, depth, stencil, constants, entry, indirect})` | Component-level "instanced primitive layer" abstraction over `draw` |
| `effect(gpu, wgsl)` full-screen fragment stage with injected top-origin `uv` | Compositing conventions, colormap effects |
| `compute(gpu, wgsl)`, `storage(gpu, bytes, {access, indirect})`, `pingPongStorage`, indirect dispatch | Binning/reduction/selection kernels; workgroup-size tuning via `constants` |
| `frame(gpu, cb)` / `frameLoop(gpu, cb, {fps})` — one encoder, one submit; `frame.pass({target, clear, viewport, scissor, timer, visibility, depthReadOnly})` | **The multi-component scheduler**: collect every mounted component's passes into ONE `frame()` |
| `bundle(gpu, {target}, rec)` + `pass.bundles()` — record once, replay | Bundle invalidation policy tied to component state |
| Pipeline cache keyed by shader × target signature; `compile()` / `compileSync()` pre-warm | Pre-warm orchestration at mount / route transition |
| `uniforms(gpu, values)` shared uniform object; `UniformPool` + dynamic offsets (`vgpu/core`) | Global uniform block (viewport, DPR, theme, time) shared across components |
| `clock(gpu)` (`time`/`deltaTime`/`frameCount`/`advance`) | Frame budget accounting, adaptive quality |
| `timer(gpu)` GPU spans (needs `timestamp-query`); `visibility(gpu)` occlusion queries | Profiler UI + honest metric surface |
| WGSL module system: imports, DCE, minify, source maps, `reflectSource()`, Vite/webpack/Turbopack loaders, `npx vgpu check` | Shared WGSL module package; codegen of TS uniform types from reflection |
| `vgpu/mock` (`createMockAdapter`) deterministic no-GPU tests; `vgpu/node` (Dawn + software renderer) headless pixels; `@vgpu/render/perf` `gpuFrameTime`, `pixelDiff` | The test harness that uses them; leak assertions; snapshot corpus |
| `gpu.onError`, `gpu.settled()`, `gpu.dispose()`, structured `VGPU-*` error codes | Error surfacing to React error boundaries; dev-mode diagnostics |
| `vgpu/scene` (3D geometry, cameras, materials, orbit controls) | **Nothing — we do not use it.** 2D data components have a viewport, not a scene |

**Gaps vgpu explicitly does not cover, which are therefore our problem:**

- **Text.** No font, glyph, atlas, or SDF support anywhere in vgpu. Ours entirely (§13.4).
- **Picking / hit testing.** No helpers. Ours entirely (§9.5).
- **Device-loss recovery.** vgpu's docs state it does not recover a lost device. Ours entirely (§10.6).
- **Multi-component scheduling.** vgpu gives one frame loop; deciding what goes into it is ours.
- **Any 2D layout / viewport / axis / interaction model.** Ours.
- **Accessibility.** Ours.

### 9.3 Package boundaries and what is deliberately *not* a package

```text
packages/
  core/        framework-free runtime. depends: vgpu. no React, no DOM assumptions beyond canvas.
  react/       adapter. depends: core, react.
  wgsl/        shared WGSL modules (structs + functions only — see §13.2). depends: nothing.
  testing/     harness over vgpu/mock + vgpu/node + @vgpu/render/perf. dev-only.
  cli/         registry install ("npx gpu-components add timeline") + bundler-config doctor.
```

The brief sketched separate `renderer/`, `runtime/`, `shaders/`, `components/` packages. **We collapse `renderer` + `runtime` into `core`** — with vgpu underneath, the "renderer" is a few hundred lines of pass composition and splitting it creates a circular-dependency trap and a versioning burden for no benefit. **Components are not a package at all** — they are registry source (§18). Revisit only when a second framework adapter lands.

### 9.4 The Component Model

The brief proposes `initialize / update / render / dispose` and asks whether that interface is right, and separately sketches an eight-stage lifecycle (`create · initialize · prepare · update · compute · render · postRender · dispose`). **The eight-stage version is over-specified and the four-method version is nearly right.** Here is the minimum that actually works, with justification for each method and for each rejection.

```ts
interface GpuComponent<Props = unknown> {
  readonly id: string;

  /** Allocate stable GPU resources. Runs once. The ONLY place pipelines are created. */
  create(ctx: ComponentContext): void;

  /** Props changed. May write/resize buffers. Must NOT create pipelines. Marks dirty. */
  update(props: Props): void;

  /** Contribute passes to the shared frame. Pure: no allocation, no submit. */
  plan(frame: FrameContext): RenderPlan;

  /** Release everything create() and update() allocated. Idempotent. */
  dispose(): void;

  // ---- optional ----
  hitTest?(x: number, y: number): HitResult | null;   // CPU spatial index
  describe?(): SemanticModel;                          // drives the a11y overlay
  onContextRestored?(): void;                          // after device-loss recovery
}

interface ComponentContext {
  readonly runtime: GpuRuntime;
  readonly gpu: Gpu;                     // vgpu context — documented escape hatch
  readonly surface: SurfaceHandle;
  readonly globals: SharedUniforms<Globals>;
  readonly registry: ResourceRegistry;
  readonly caps: Capabilities;
  readonly onDispose: (fn: () => void) => void;   // teardown accumulator
}
```

**Why these four, and why not the others:**

| Stage from the brief | Verdict | Reason |
|---|---|---|
| `create` + `initialize` | **Merged into `create()`** | Two-phase construction exists to defer async work. Ours is synchronous — the device is already ready before any component mounts, because the runtime gates on it. Two methods would just mean "which one do I put it in?" |
| `prepare` | **Rejected** | Its purpose in engine architectures is CPU-side culling and sorting before encoding. Our culling is GPU-side (the binning kernel) and our sorting happened once at ingest. It would be an empty method on every component |
| `update` | **Kept** | The props boundary. Critically, this is where the "no pipeline creation outside `create()`" rule is enforced |
| `compute` + `render` | **Merged into `plan()`** | Separating them forces the component to know the scheduler's ordering. `plan()` returns *both* pass lists and the **scheduler** guarantees all compute precedes all render across all components — which is stronger, because a two-method interface can only order a component against itself |
| `postRender` | **Rejected** | Its uses are readback and profiling. Readback is off the hot path by policy (§14), and profiling is the runtime's job via `timer` spans. Adding it would invite exactly the per-frame `target.read()` that vgpu's docs warn against |
| `dispose` | **Kept, and must be idempotent** | StrictMode and Fast Refresh will call it twice |

**`plan()` is the important design choice.** It is *declarative and pure*: it returns a description of passes, it does not encode them. That gives us four things a `render(frame)` method could not: the scheduler can globally order compute before render; it can skip a clean component entirely; it can attach a profiler span to every pass uniformly; and the plan is inspectable in tests without a GPU (a `vgpu/mock` test can assert "this component contributes two render passes and one dispatch" without rendering anything).

**How a component declares its dependencies:**

| Declared thing | Mechanism | Notes |
|---|---|---|
| GPU resources | allocated in `create()`, registered via `ctx.onDispose` | Ownership is explicit; no GC-based lifetime |
| Shared resources | `ctx.registry.acquire(key, factory)` | Ref-counted, content-keyed, deduped |
| Uniforms | `set()` by WGSL variable name; types generated from reflection | vgpu reflects bindings from the WGSL — we never hand-write a bind group layout |
| Render / compute passes | returned from `plan()` | With `reads`/`writes` declared for the future frame-graph path |
| Inputs (props) | the `Props` type parameter | Columnar typed arrays preferred |
| Outputs / events | callbacks passed in props, invoked at most once per frame | Never invoked mid-encode |
| Semantics | `describe()` → `SemanticModel` | The single source for both labels and the a11y tree |

### 9.5 Interaction Architecture

Interaction primitives live in `core` and are **DOM-event-source agnostic** (they consume normalised events, so a Vue or vanilla adapter feeds them the same way). Components compose them; they do not reimplement them.

```text
core/interaction/
  pointer.ts    down/move/up/cancel, capture, multi-button
  wheel.ts      deltaMode normalisation (LINE vs PIXEL vs PAGE), trackpad-vs-mouse heuristics
  keyboard.ts   roving focus, repeat handling, modifier state
  touch.ts      pinch-zoom, two-finger pan, tap vs drag thresholds
  gesture.ts    pan / zoom / brush / lasso state machines built on the above
  viewport.ts   domain <-> screen transforms, clamping, inertia (reduced-motion aware)
```

**Where each interaction is computed — CPU, GPU, or hybrid:**

| Interaction | Where | Why |
|---|---|---|
| Pan / zoom | **CPU → one uniform write** | The transform is 64 bytes. Re-walking data would defeat the entire design |
| Hover / click hit-test | **CPU by default** | Our data is sorted by (track, start) with a per-track index, so it is an O(log n) binary search — exact, immediate, and no frame of latency. This is *better* than GPU picking, not a fallback from it |
| Hover / click, unsortable layers | **GPU, async** | Graph nodes and dense scatter have no cheap CPU index. Render IDs into a small scissored target, read asynchronously, apply next frame |
| Brush / lasso selection | **Hybrid** | CPU computes the region; a compute pass tests every element against it and writes a **bitset mask** in a storage buffer; the render shader branches on the bit. Selecting 100k elements costs one dispatch, not a JS loop |
| Selection rendering | **GPU** | `isSelected(mask, i)` in the shader — no separate draw, no CPU set |
| Keyboard navigation | **CPU** | It moves focus through the *semantic* model, which is CPU-side by definition |
| Tooltip content | **CPU** | Strings. Never GPU |

**The rule on GPU picking, stated plainly:** vgpu documents `target.read()` and `StorageBuffer.read()` as being for "tests, snapshots, and diagnostics", explicitly *not* a per-frame hot path — a synchronous readback stalls the pipeline. So **GPU picking is always asynchronous and always one frame late**, and we only reach for it when a CPU spatial index is genuinely impractical. For the Timeline, it is not needed at all; it exists in `core` for the components that will need it (graph, dense scatter), so those components do not each invent it.

---

## 10. Runtime Design

Every subsystem below carries a v1 verdict. **Four of the nine subsystems in the brief's sketch do not survive contact with vgpu**, because vgpu already owns them.

### 10.1 `GpuRuntime` — the root object · **v1: yes**

**Responsibility:** own the `Gpu`, the registry of mounted components, the surfaces, the scheduler, the shared uniforms, and the profiler. One per `<GPUProvider>`.

```ts
interface GpuRuntimeOptions {
  adopt?: GPUDevice;                       // -> vgpu initFromDevice()
  powerPreference?: GPUPowerPreference;
  profiling?: boolean;                     // requests "timestamp-query" if available
  fps?: number;                            // frameLoop throttle
  onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

interface GpuRuntime {
  readonly gpu: Gpu;                       // vgpu context — escape hatch, documented as such
  readonly caps: Capabilities;
  readonly globals: SharedUniforms<Globals>;
  readonly profiler: Profiler;
  registerSurface(canvas: HTMLCanvasElement, opts?): SurfaceHandle;
  mount(component: GpuComponent): MountHandle;
  invalidate(reason?: string): void;       // request a frame
  dispose(): void;
}
```

**Lifecycle:** `create → (async) init → ready | unsupported → running → disposed`. `init()` is async and may fail with `VGPU-RING1-UNSUPPORTED`; the runtime surfaces that as `caps.webgpu === false` rather than throwing, so the fallback path is a state, not an exception.

**Ownership:** owns the device (unless adopted), all surfaces, all shared resources. Components own only their own resources and are guaranteed `dispose()` before the runtime disposes.

### 10.2 `FrameScheduler` — **v1: yes. This is the core value-add.**

**Responsibility:** turn N mounted components into exactly one `frame(gpu, …)` per tick.

```ts
// conceptually, inside frameLoop(gpu, …)
frameLoop(runtime.gpu, (f) => {
  runtime.globals.set({ time: clock(gpu).time, dpr });          // one shared uniform write
  const plans = components.filter(c => c.dirty || c.animating)
                          .map(c => c.plan(frameCtx));           // no encoding yet
  for (const p of plans) for (const pass of p.computePasses) pass.dispatch();
  for (const p of plans) for (const pass of p.renderPasses) {
    f.pass({ target: pass.target, clear: pass.clear, scissor: pass.scissor,
             timer: profiler.span(pass.name) },
           (encoder) => pass.encode(encoder));
  }
});
```

Properties this buys, all directly enabled by documented vgpu behaviour:
- **One command buffer, one submit per page tick.** vgpu's `frame()` encodes every pass into one encoder and submits once. Six components on a page = one submit, not six.
- **Ordering is explicit:** all compute before all render, so a component's binning pass cannot land after a consumer's draw.
- **Dirty tracking:** a component that did not change contributes no passes. Static pages cost zero GPU work; vgpu's `set()` does no equality checking, so *we* must gate writes (`set()` "performs no equality check — a value written every frame is uploaded every frame").
- **Frame budget:** the profiler attaches a `timer.span(name)` per pass, so "which component blew the budget" is answerable.

**Non-goals:** we do not schedule across devices, do not do automatic pass reordering, and do not do automatic resource aliasing (§12).

**Reentrancy hazard (from vgpu docs, must be encoded as a lint/assert):** `frame(gpu)` throws `VGPU-FRAME-REENTRANT` if called inside another frame callback *or* inside a surface `onResize` callback — and the immediate fire of `onResize` on subscription counts. Our `registerSurface` must subscribe to `onResize` outside any frame, and resize handling must set state consumed by the *next* frame, never render inline.

### 10.3 `ResourceRegistry` — **v1: yes, but small** (§14)

### 10.4 `ShaderManager` — **v1: NO.** vgpu owns this completely: the WGSL module resolver, DCE, minifier, source maps, `reflectSource()`, the bundler loaders, and the device-level pipeline cache keyed by shader × target signature. Building a shader manager on top would be pure duplication. What we build instead is a *shared WGSL module package* and a *build-time typegen step* (§13) — neither is a runtime subsystem.

### 10.5 `ComputeManager` — **v1: NO.** `compute(gpu, wgsl)` + `storage(gpu, …)` + indirect dispatch is already the right abstraction. Components create and dispatch their own kernels. We ship *kernels* (binning, reduction, selection) as reusable WGSL + thin TS wrappers, not a manager.

### 10.6 `CapabilityManager` — **v1: yes, and it must also own device loss**

```ts
interface Capabilities {
  webgpu: boolean;                    // init() succeeded
  timestampQuery: boolean;            // -> profiler GPU spans
  float32Filterable: boolean;         // -> HDR/float target sampling strategy
  maxStorageBufferBindingSize: number;// -> max spans per buffer, chunking threshold
  maxBufferSize: number;
  maxTextureDimension2D: number;      // -> glyph atlas sizing
  maxComputeWorkgroupsPerDimension: number; // -> dispatch clamping
  tier: 'gpu' | 'fallback' | 'none';
}
```

Feature requests must be conditional — vgpu is explicit that unsupported `requiredFeatures` names **fail `init()`**, so we probe `navigator.gpu.requestAdapter()` for supported features first, then request only the intersection. Never request `timestamp-query` speculatively.

**Device loss is ours.** vgpu does not recover a lost device. Design consequence, and it constrains §14: **every GPU buffer must have a CPU-side source of truth or a pure function that regenerates it.** On loss: mark runtime `tier='none'`, dispose, re-`init()` with backoff, recreate surfaces, replay every component's `create()` + re-upload from source of truth. Components never see the loss beyond a `onContextRestored()` hook.

### 10.7 `Profiler` — **v1: yes, restricted to real metrics** (§28)

> **Shipped (2026-08-30):** `packages/core/src/profiler.ts`'s `Profiler`/`createProfiler`, wired
> into `FrameScheduler` (a `timer.span("${componentId}:${passName}")` per render pass — component-id-
> qualified, since `RenderPass.name` collides across components, e.g. every `TimelineComponent` names
> its pass `"timeline"`) and exposed as `runtime.profiler`. CPU frame stats (`FrameStats` —
> `cpuMs`/`componentCount`/`passCount`/`dispatchCount`) are tracked unconditionally, free; the GPU
> half (`span()`/`onGpuResults()`, real `timestamp-query` timing) is gated on `options.profiling &&
> caps.timestampQuery`, matching `initGpu()`'s existing feature-request gating. Fixed a real bug this
> surfaced in `@gpu-components/testing`'s `createMockGpu`: it configured the mock *adapter's*
> declared feature support but never passed `requiredFeatures` to request the feature on the device
> itself, so `timer(gpu)` failed with `VGPU-TIMER-INVALID` even when the caller asked for
> `["timestamp-query"]` — nothing had exercised a feature-gated API through that helper before.
> **Not done:** compute-pass GPU timing (`vgpu`'s `Compute.dispatch()` has no `timer` option the way
> `FramePassOptions` does — a different, larger integration point); the React `<GpuInspector>` panel
> and its warnings pane (§28.2) — this is the data layer they would read from, not the UI itself. The
> bench investigation's own conclusion (§29 Phase 3's "next phase" list, item 4) — that a real signal
> on the shared-vs-independent-device founding claim needs direct GPU timing, not
> `requestAnimationFrame`-interval measurement — can now actually be attempted; not yet done.

### 10.8 `Renderer` as a distinct object — **v1: NO.** vgpu's `draw`/`effect` *are* the renderer. A `Renderer` class here would be a pass-through.

### 10.9 `Device` / `Queue` as our own abstractions — **v1: NO.** `gpu.device` and `gpu.gpu` exist as documented escape hatches. Wrapping them hides vgpu's structured `VGPU-*` errors, which are one of its best features.

---

## 11. Shared GPU Context / Scene Design

### 11.1 The decision: one device, many canvases, one frame

```tsx
<GPUProvider>          {/* one init() → one Gpu → one GPUDevice */}
  <GPUTimeline />      {/* own <canvas> → surface(gpu, canvasA) */}
  <GPUHeatmap  />      {/* own <canvas> → surface(gpu, canvasB) */}
</GPUProvider>
```

This is **idiomatic vgpu, not a workaround.** Its `Surface` docs show multi-canvas rendering from a single `Gpu` as a first-class example, and its `Gpu` docs state that "every other object — surfaces, targets, effects, draws, frames — is created from that context, so all of them share one device". A canvas may host exactly one live `Surface` (`VGPU-SURFACE-DUPLICATE` otherwise), which maps cleanly onto one component per canvas.

**Why one canvas per component rather than one giant page-sized canvas with scissor rects:** the DOM stays in charge of layout, scrolling, stacking, and overflow. A single mega-canvas requires us to reimplement layout, clipping and scroll sync, and it breaks whenever a component sits inside an independently scrolling container. The cost of N canvases is N swapchains — real but modest, and each is only as large as the component. **Revisit only** if a use case demands components sampling each other's output at page level; in that case the same runtime can render components into shared `target()`s and composite, with no API change for users.

What *is* shared, and this is the whole point:

| Shared | Mechanism |
|---|---|
| Device, queue, adapter | one `init()` |
| Frame loop and submit | one `frameLoop(gpu, …)`, one command buffer |
| Pipeline & shader cache | vgpu's device-level cache, keyed by shader × target signature |
| Global uniforms (time, DPR, theme, hover state) | one `uniforms(gpu, {...})` object bound into every shader |
| Samplers | `sampler(gpu, desc)` is cached by descriptor in vgpu |
| Colormap textures, glyph atlas | our `ResourceRegistry`, ref-counted by content key |
| Transient per-frame uniforms | one `UniformPool` (`vgpu/core`) + dynamic offsets |
| Offscreen scratch targets | pooled by `(size, format, depth, msaa)` |
| Profiler spans | one `timer(gpu)` |

### 11.2 Resize, DPR, and the reentrancy rule

`surface(gpu, canvas, { dpr: [1, 2] })` clamps DPR (important: uncapped DPR on a 3× phone quadruples fill cost for no visual gain). Auto-resize runs at the frame boundary before user callbacks. Our `SurfaceHandle` subscribes `onResize` **once, outside any frame**, and the handler only (a) resizes derived targets, (b) writes size uniforms, (c) marks the component dirty. It must never call `frame()` — that is `VGPU-FRAME-REENTRANT`.

### 11.3 Scene graph vs. frame graph — the comparison

| | **Scene graph** | **Frame/render graph** | **Flat pass list (our choice)** |
|---|---|---|---|
| Models | hierarchical transforms, parent/child, materials, culling | passes as nodes, resources as edges; auto-derives barriers, ordering, transient aliasing | an ordered list of compute + render passes per component |
| Fits | 3D worlds with deep hierarchies | AAA renderers with 30–80 passes and tight VRAM budgets | 2D data surfaces: one viewport, 2–6 passes per component |
| Cost | per-node JS objects (fatal at 1M spans); traversal per frame | substantial machinery: resource lifetime analysis, aliasing, pass culling | ~200 lines |
| What it would buy us | nothing — our components have **no hierarchy**, only a viewport transform | automatic aliasing of transient targets (we have ~3), automatic barriers (**WebGPU already does barriers**, and vgpu owns encoders) | explicitness; trivially debuggable |

**Recommendation: flat ordered pass list — a degenerate frame graph — with a documented upgrade path.** A scene graph is categorically the wrong model here: the data lives in typed arrays and storage buffers, not in a node tree, and materialising one JS node per span is exactly the mistake that makes PixiJS-style display lists fail at this scale. A full frame graph is over-engineering at our pass count, and its two headline features (barrier insertion, pass reordering) are already handled by WebGPU and forbidden by our determinism requirements respectively.

The upgrade path stays open because a `RenderPlan` **declares** its inputs and outputs:

```ts
interface RenderPass {
  name: string;
  target: Target | 'surface';
  reads?: ResourceRef[];        // declared, unused in v1 — enables future auto-ordering
  writes?: ResourceRef[];
  clear?: ClearColor | false;
  scissor?: Rect;
  encode(pass: FramePass): void;
}
interface RenderPlan { computePasses: ComputePass[]; renderPasses: RenderPass[]; }
```

If we ever hit 20+ passes with real aliasing pressure, `reads`/`writes` are already there and the scheduler grows a topological sort. We pay nothing for the option now.

---

## 12. Rendering / Frame Graph Design

### 12.1 The rendering primitives the core exposes

Deliberately four. Not a general 2D vector renderer — a general 2D renderer is a different, much larger project (that is PixiJS), and building one would violate the "do not over-engineer the MVP" constraint.

1. **`InstancedQuadLayer`** — the workhorse. Per-instance attributes in a `storage` buffer; one `draw()` with `instances: N` and `vertices: 6` (or 3, using vgpu's documented no-geometry path where the vertex shader spawns triangles from `@builtin(vertex_index)` + `@builtin(instance_index)` — zero vertex buffers). Supports rounded corners, borders, and per-instance colour via shader, not via extra draws.
2. **`LineLayer`** — instanced quads expanded to screen-space thick lines in the vertex stage (axis rules, connectors, edges).
3. **`RasterLayer`** — a texture drawn through `effect(gpu, …)` with a colormap. Used for LOD density fields and heatmaps.
4. **`LabelLayer`** — v1: DOM overlay. v2: glyph-atlas instanced quads (same `InstancedQuadLayer`, different atlas sampling).

Everything else in v1 is composed from these. `blend: 'alpha'` (a documented vgpu preset), `depth: false` for 2D overlays, `cull: 'none'`.

### 12.2 The Timeline frame, concretely

```text
per tick, inside ONE frame(gpu, …):

  [compute] binSpans          storage(spans) + viewport uniform
                              → atomics into density[trackCount × pixelColumns]
                              → indirect args buffer (visible instance count)
                              dispatch: ceil(spanCount / WG), WG tuned via `constants`

  [compute] reduceDensity     density → max per track (for colour normalisation)
                              (skipped when the viewport did not change)

  [render]  pass A → surface  clear
                              LOD ≥ threshold: RasterLayer draws the density field
                              LOD <  threshold: InstancedQuadLayer draws spans,
                                                indirect: argsBuffer
  [render]  pass B → surface  clear:false — overlay: hover outline, selection,
                              brush rect, axis rules, cursor
```

Two passes, both to the surface, one indirect draw, two dispatches. `bundle()` is *not* used in v1: the Timeline's draws change every frame (indirect counts, viewport, selection), and vgpu is explicit that bundles pay off for *static* repeated draws. Bundles become relevant when we add static chrome layers — noted in phase 4, not speculated on now.

### 12.3 Zoom, pan, clipping, viewport

Pan/zoom is **one uniform write**, never a data re-walk:

```wgsl
struct Viewport {
  timeToClip : vec2f,   // scale, offset — maps time → clip x
  trackToClip: vec2f,   // scale, offset — maps track row → clip y
  pxSize     : vec2f,   // 1/resolution, for screen-space widths and min-width clamping
  lod        : f32,
}
```

Clipping to a component's rect uses `FramePassOptions.scissor` (documented). Sub-pixel spans are clamped to a minimum width **in the vertex shader** so that a 1ns span is still visible at 1px — a correctness requirement for trace viewers, and free on the GPU.

### 12.4 Recommendation restated

**Option C — hybrid, weighted to the render-pass list.** Flat ordered passes per component, composed by a scheduler, with declared (but not yet enforced) resource edges. No scene graph anywhere in the codebase. Justification is §11.3.

---

## 13. Shader Architecture

### 13.1 The pipeline, using vgpu's actual toolchain

```text
.wgsl source (ours + @gpu-components/wgsl modules)
   │  vgpu WGSL loader (wgslVitePlugin / wgslWebpackLoader / Turbopack)
   ▼  resolveShader(): import graph → DCE → optional minify → source maps
ShaderSource { version, wgsl }  +  Reflection { bindings, entryPoints, structs,
   │                                            overrides, hostShareableLayouts }
   ▼
draw(gpu,{shader}) / effect(gpu, src) / compute(gpu, src)
   │  reflection-driven bind group layouts; set() by WGSL variable name
   ▼  pipeline cache keyed by shader × (colour formats, depth format, sample count)
GPU
```

We add exactly one thing to this: **build-time TypeScript typegen from `reflectSource()`**, so `set({ viewport: {...} })` is type-checked against the WGSL struct rather than being `Record<string, unknown>`.

### 13.2 The hard constraint on shared WGSL modules

vgpu rejects any imported (non-entry) module that declares `@group`/`@binding` with `VGPU-RESOLVE-MODULE-BINDING`. **Therefore `@gpu-components/wgsl` exports only structs and pure functions; every binding is declared in the component's entry shader.** This is a real design constraint that must be in the contributor docs, and it is enforced in CI by `npx vgpu check` on every `.wgsl` file.

`@gpu-components/wgsl` v1 contents:

```text
viewport.wgsl    struct Viewport; fn timeToClip(); fn trackToClip(); fn minWidthClamp()
quad.wgsl        fn quadCorner(vertexIndex) -> vec2f     // the no-geometry 6-vertex quad
color.wgsl       fn srgbToLinear(); fn linearToSrgb(); fn applyColormap(t, LUT)
pack.wgsl        fn unpackRgba8(u32); fn packId(u32) -> vec4f; fn unpackId(vec4f) -> u32
select.wgsl      fn isSelected(mask: ptr<storage, array<u32>>, i: u32) -> bool   // bitset
lod.wgsl         fn lodBucket(); fn pixelColumn()
```

We also depend on `@vgpu/wgsl-std` for `color`, `hash`, and `fullscreen` rather than writing our own.

### 13.3 `<GPUShader src="./x.wgsl" uniforms={{…}} />` — rejected

The brief asks whether this JSX form beats generated TypeScript wrappers. **It loses, decisively:**
- It defers to runtime what the loader already does at build time (resolution, validation, DCE, source maps), so shader errors surface as red screens instead of failed builds.
- It gives up all type safety on `uniforms`; the typegen path gives full checking from reflection.
- It creates a React-shaped concept in what should be a framework-independent layer, violating a stated constraint.
- It invites runtime string-concatenated WGSL, which is the security hazard in §24.

**Decision:** shaders are build-time artefacts. The user-facing customisation surface is *editing the `.wgsl` file the CLI copied into their repo* — which is exactly the shadcn promise, applied to shaders.

### 13.4 Text — the staged plan

| Phase | Approach | Budget | Why |
|---|---|---|---|
| **v1 (phase 2)** | **DOM overlay.** Absolutely positioned `<span>`s over the canvas, virtualised to visible labels, positioned from the same viewport transform the shader uses | ≤ ~400 labels/frame | Perfect text quality, real fonts, RTL/IME free, **selectable and copyable**, and it *is* the accessibility layer. Zero GPU text engine needed |
| **v2 (phase 4)** | **Grayscale glyph atlas.** Rasterise glyphs with Canvas2D at the device DPR into a `texture_2d_array`, upload once, draw labels as instanced quads sampling the atlas | ~50k glyphs/frame | Needed only when label counts exceed DOM budget — i.e. when the DataGrid lands |
| **v3 (if ever)** | SDF/MSDF atlas (MapLibre-style) | resolution-independent | Only if zoom-independent crispness is required. Explicitly deferred |

The v1 choice is what makes the Timeline shippable in four weeks. It is not a compromise we are hiding — it is the reason this component was selected.

### 13.5 Hot reload, errors, validation

- **Hot reload:** the Vite/webpack loaders already invalidate on `.wgsl` change and report dependencies via `onDependency`. Our components re-create their `draw`/`compute` on module change; nothing else moves.
- **Errors:** vgpu delivers async pipeline failures through `gpu.onError` with structured `VGPU-*` codes, `fix`, and `where` fields. The runtime forwards them to a React error boundary in dev and to `onError` in prod. We never swallow them.
- **CI:** `npx vgpu check ./**/*.wgsl --require-validation` (or `VGPU_VALIDATE=require`) fails the build on invalid WGSL, and prints reflection JSON we diff to catch accidental binding-layout changes.

---

## 14. Resource Management

### 14.1 What we build and what we refuse to build

vgpu already caches pipelines (by shader × signature), bind groups (by resource identity), and samplers (by descriptor). It is explicit that "rebinding the same resources is free". **So we do not build a general resource manager.** We build three narrow things:

**(a) `ResourceRegistry` — ref-counted *shared* resources only.**
```ts
registry.acquire('colormap:viridis:256', () => makeColormapTexture(gpu, viridis));
registry.acquire('glyphAtlas:Inter-400@2x', () => rasteriseAtlas(gpu, …));
registry.release(key);   // destroys at refcount 0
```
Scope: colormaps, glyph atlases, shared LUTs, the default sampler set. **Not** component-owned buffers — those are owned by the component and destroyed in its `dispose()`. Keys are content-derived so identical requests dedupe.

**(b) `TargetPool` — offscreen scratch targets keyed by `(w, h, format, depth, msaa)`.**
Borrowed for a frame, returned at frame end. Prevents the documented anti-pattern of creating a `target()` inside the render loop (vgpu's perf docs call this out explicitly — it churns bind-group caches).

**(c) `InstanceBuffer` — a growable storage buffer with a CPU mirror.**
```ts
interface InstanceBuffer<T> {
  readonly capacity: number;
  readonly count: number;
  readonly storage: StorageBuffer;      // vgpu storage(gpu, bytes, 'read')
  readonly mirror: ArrayBuffer;         // CPU source of truth — required for device-loss replay
  write(index: number, value: T): void;
  flush(): void;                        // one queue write for the dirty range
  grow(newCapacity: number): void;      // geometric, x1.5; recreates + copies
}
```
Growth is geometric and logged in dev — a buffer that grows every frame is a bug and the profiler should say so.

### 14.2 Policies

- **Reference counting:** only for registry (shared) resources. Component-owned resources use plain ownership + `dispose()`.
- **Pooling:** only for offscreen targets and the transient uniform ring (`UniformPool`, `capacityBytes` sized from measured per-frame usage, with `beginFrame`/`endFrame` bracketing enforced by the scheduler — `assertReadyForSubmit()` catches unflushed pushes).
- **Lazy allocation:** buffers allocate on first data, not on mount. A mounted-but-empty component costs one bind group.
- **Deduplication:** by content key in the registry; by resource identity in vgpu's own bind-group cache below us.
- **Disposal:** every `create()` registers a teardown into a component-scoped disposer array; `dispose()` runs it in reverse. Verified by test, not by convention (§23.1).
- **Device-loss replay:** every GPU buffer either mirrors CPU memory or is regenerable by a pure function recorded at creation. This is the constraint device-loss recovery imposes on the whole design (§10.6).

### 14.3 Sizing limits, and what happens when a dataset is too big

`caps.maxStorageBufferBindingSize` (commonly 128MiB) bounds a single bound buffer. At 32 bytes/span that is ~4M spans per buffer. Above that we **chunk**: multiple storage buffers, one draw per chunk, counts still indirect. The threshold is computed from device limits at runtime, never hardcoded. Exceeding the total budget produces a typed error with the actual numbers, not a silent GPU crash (§24).

---

## 15. React Integration

### 15.1 The minimum API

The brief lists seven candidate hooks. **We ship three**, because the others expose GPU concepts that a component author (not an application author) needs, and component authors are writing imperative renderer classes anyway.

```tsx
<GPUProvider fallback="canvas2d" onError={…}>
  <GPUTimeline spans={spans} tracks={tracks} onSelect={…} />
</GPUProvider>
```

```ts
useGpu(): GpuRuntime | null            // null until ready / when unsupported
useGpuCanvas(opts): {                  // canvas ref + surface lifecycle + DPR + resize
  ref: RefObject<HTMLCanvasElement>;
  surface: SurfaceHandle | null;
  size: { width: number; height: number; dpr: number };
}
useGpuComponent<P>(factory, props): MountHandle   // create once, update on props, dispose on unmount
```

**Rejected for v1, with reasons:** `useGPUBuffer` / `useGPUTexture` / `useGPUShader` / `useGPURenderPass` — these turn React's lifecycle into the GPU resource lifecycle, which is precisely the coupling the brief forbids and the bug class §15.3 is about. Component internals allocate resources imperatively in `create()`. `useGPUFrame` collapses into `useGpuComponent`'s `plan()`; if an application genuinely needs a per-frame callback we expose `runtime.onFrame(cb)` — not a hook.

### 15.2 Lifecycle mapping

```text
React mount        → useGpuComponent: factory() → component.create(ctx)   [once]
React props change → component.update(props)  → mark dirty                [no GPU alloc]
rAF tick           → scheduler → component.plan(frameCtx) → encode        [outside React]
React unmount      → component.dispose()                                  [always runs]
StrictMode double-invoke → create/dispose/create must be idempotent and leak-free
```

**Rules, enforced by lint and by test:**
- **GPU resources are created in `create()` and only there.** `update()` may write buffers and resize them; it must never create pipelines. (Pipeline creation inside a frame is the documented first-frame hitch; `compile()` at mount is the fix.)
- **Render state lives in refs and in GPU buffers, never in React state.** Hover, viewport, selection are refs + uniform writes. A pan gesture must cause **zero React re-renders**; it writes a uniform and marks dirty.
- **React state is for *semantics*** — selected IDs surfaced to the app, visible label set, a11y focus — and is updated at most once per frame, batched, and only when it actually changed.
- **`dispose()` is idempotent** (vgpu's own wrappers are; ours must be too), because StrictMode and Fast Refresh will call it twice.

### 15.3 Concurrent rendering, StrictMode, Suspense

- **StrictMode double-invocation** is the single most common source of GPU leaks in R3F-style libraries. Mitigation: idempotent `dispose()`, and a dev-only registry that counts live GPU objects per component and warns when a remount increases the count. This is a *test*, not a hope (§23.1).
- **Concurrent rendering / `useTransition`:** React may render a component tree that never commits. Therefore **nothing GPU happens during render — only in effects.** `useGpuComponent` does all work in `useEffect`/`useLayoutEffect`.
- **Suspense:** the runtime never suspends. `useGpu()` returns `null` while initialising and the component renders its skeleton; this keeps the async device init out of React's control flow.
- **Provider is ref-counted** so two providers in one tree (a bug, but it happens with nested layouts/portals) share one device rather than creating two, via a module-level `WeakMap` keyed by an opt-in `deviceKey`.

---

## 16. Framework Independence

### 16.1 The rule

**`@gpu-components/core` must compile and pass its full test suite with `react` uninstalled.** Enforced in CI by a workspace-level dependency check plus an ESLint `no-restricted-imports` rule banning `react*` from `packages/core/**`.

| Belongs in `core` | Belongs in `react` | Belongs in the component (registry source) |
|---|---|---|
| `GpuRuntime`, device lifecycle, adoption | `GPUProvider`, context | The renderer class (`TimelineRenderer`) |
| `FrameScheduler`, `RenderPlan` | `useGpu`, `useGpuCanvas`, `useGpuComponent` | Its `.wgsl` shaders |
| `ResourceRegistry`, `TargetPool`, `InstanceBuffer` | Error-boundary integration | Its view model + data transforms |
| `Capabilities`, device-loss recovery | StrictMode/Fast-Refresh guards | Its interaction handlers |
| `Profiler`, `Picker`, `ViewportModel` | Ref-counted provider dedupe | Its a11y semantic model |
| Interaction primitives (pointer/wheel/keyboard state machines, **DOM-event-source agnostic**) | DOM event wiring | Its `<GPUTimeline>` React wrapper (thin) |
| Fallback Canvas2D renderer for the four primitives | — | Its Canvas2D fallback *policy* (what to degrade) |

### 16.2 Adapters after v1

`@gpu-components/vue` and `/svelte` are ~200 lines each if the rule above holds, and a `/vanilla` adapter is a no-op re-export of `core`. **We ship none of them in v1** and we do not add abstraction "for" them — the discipline of keeping `core` React-free is the entire preparation. The first non-React adapter is written by a contributor or by us in phase 7, and if it requires a `core` change, that change is the bug report we needed.

---

## 17. Component API Philosophy

### 17.1 Principles

- **TypeScript-first, no `any` in public types.** Uniform structs are generated from WGSL reflection.
- **Declarative props for *what*, imperative handle for *how*.** `<GPUTimeline spans={…} />` plus a `ref` exposing `zoomTo()`, `select()`, `exportImage()`.
- **Data in, typed arrays preferred.** The public API accepts `SpanData[]` (ergonomic) *or* a columnar `{ start: Float64Array, dur: Float64Array, track: Uint16Array, … }` (zero-copy fast path). The columnar form is documented as the one that scales; the object form is documented with its conversion cost.
- **Props are the whole configuration surface** — no giant `options` object, no `setOption`-style imperative config.
- **No magic.** No global registries, no implicit singletons the user cannot see, no automatic quality degradation without a callback telling them it happened.
- **Escape hatches are documented, not hidden.** `runtime.gpu` is the vgpu context; using it is supported and versioned.
- **Tree-shakeable.** Named exports, `sideEffects: false`, no barrel that pulls the whole library.

### 17.2 The shape of a component's public API

```tsx
<GPUTimeline
  spans={spans}                              // SpanData[] | ColumnarSpans
  tracks={tracks}                            // TrackDef[]
  domain={[t0, t1]}                          // controlled viewport (optional)
  onDomainChange={setDomain}                 //   ↑ uncontrolled if omitted
  selection={selectedIds}                    // controlled selection (optional)
  onSelectionChange={setSelection}
  colorBy={(s) => s.category}                // CPU: category → index, uploaded as u8
  labelBy={(s) => s.name}                    // CPU: only called for visible labels
  fallback="canvas2d"                        // "canvas2d" | "none" | ReactNode
  onPerformance={(m) => …}                   // { cpuMs, gpuMs, drawCalls, dispatches, spansDrawn }
  aria-label="Request trace"
/>
```

Note what is *absent*: no `shader` prop, no `uniforms` prop, no `renderer` prop. GPU-expert extensibility comes from **owning the copied source**, not from a configuration escape hatch — which keeps the props surface honest and small.

### 17.3 Anti-patterns we commit to avoiding

Giant config objects; React concepts in `core`; hidden resource leaks (tested, §23.1); silent fallback (always fires a callback); unbounded memory growth (typed error at the limit); and "GPU because we can" (every component's docs must contain a measured crossover point below which the docs tell you to use something else).
---

## 18. CLI / Distribution Strategy

### 18.1 The decision: hybrid — versioned runtime, copied components

```bash
npm i @gpu-components/core @gpu-components/react   # versioned, semver'd, upgradeable
npx gpu-components add timeline                     # copies source into your repo
```

produces:

```text
components/gpu/timeline/
├── GPUTimeline.tsx          React wrapper (thin)
├── TimelineRenderer.ts      the imperative component: create/update/plan/dispose
├── viewModel.ts             data → columnar layout, track assignment, spatial index
├── interaction.ts           pan/zoom/hover/brush state machine
├── a11y.ts                  semantic model + DOM overlay
├── fallback.ts              Canvas2D degraded renderer
├── shaders/
│   ├── spans.wgsl           instanced span quads
│   ├── bin.wgsl             LOD density compute
│   └── overlay.wgsl         hover/selection/brush
└── types.ts
```

**Why the split at exactly this line:** the runtime is infrastructure nobody wants to fork and everybody wants patched (device management, scheduling, leak fixes, device-loss handling). The component is *policy* — colours, LOD thresholds, label rules, interaction feel, shaders — which is exactly what teams need to change and what a props API can never anticipate. shadcn's insight applied precisely.

### 18.2 Analysis of the model

| | Benefit | Cost / mitigation |
|---|---|---|
| **Versioning** | Runtime is semver'd and upgradeable | Copied components drift. **Mitigation:** stamp `// @gpu-components/timeline@0.4.2` in a header; `npx gpu-components diff timeline` shows upstream changes against your copy; `add --force` re-copies |
| **Dependency mgmt** | No transitive component deps | The CLI must verify peer versions and **configure the vgpu WGSL loader** (Vite plugin / webpack loader / Turbopack). `npx gpu-components doctor` checks this and prints the exact config diff — a real DX risk if unhandled |
| **Shader updates** | Users own and can edit shaders | Shader fixes don't auto-propagate. **Mitigation:** `diff` command; security-relevant shader fixes get a CLI `audit` warning |
| **Security** | Code is reviewable *before* it lands (better than an opaque npm dep) | Registry must be integrity-checked (§24.3) |
| **Licensing** | MIT throughout; copied code is unambiguously the user's | Header comment retains attribution + licence |
| **Tree-shaking** | Perfect — you only have the components you added | — |
| **Customisation** | Complete, down to WGSL | — |
| **Maintenance** | Our surface is the runtime, not N component APIs | Bug reports arrive against modified code. **Mitigation:** the `diff` output is requested in the issue template |

**Verdict: appropriate, and validated by the market** — `chartcn` already ships GPU components through the shadcn registry format. We use the **standard shadcn `registry.json` schema** so our components are installable by the existing `shadcn` CLI as well as ours, which removes a whole adoption barrier.

### 18.3 CLI surface (v1)

```text
npx gpu-components add <component> [--path] [--force] [--no-shaders]
npx gpu-components diff <component>        # your copy vs upstream
npx gpu-components doctor                  # bundler config, WGSL loader, WebGPU availability, versions
npx gpu-components list
```

---

## 19. Performance Strategy

### 19.1 GPU / Worker / Main-thread division

This is the section to get right; the failure mode of GPU libraries is moving the wrong work.

```text
                       ┌─────────────────────────────────────────┐
  raw input            │  MAIN THREAD                            │
  (JSON/OTLP/Arrow) ──▶│  fetch, hand off                        │
                       └──────────────┬──────────────────────────┘
                                      ▼ postMessage (Transferable)
                       ┌─────────────────────────────────────────┐
                       │  WEB WORKER  (once per dataset)         │
                       │  · parse                                │
                       │  · build columnar typed arrays          │
                       │    start:f64 dur:f64 track:u16          │
                       │    depth:u8 category:u8 id:u32          │
                       │  · sort by (track, start)               │
                       │  · build per-track index (binary-search │
                       │    boundaries) for CPU hit-testing      │
                       │  · intern label strings → id table      │
                       └──────────────┬──────────────────────────┘
                                      ▼ Transferable ArrayBuffers (zero copy)
                       ┌─────────────────────────────────────────┐
                       │  MAIN THREAD  (once)                    │
                       │  · InstanceBuffer.write + flush → GPU   │
                       └──────────────┬──────────────────────────┘
                                      ▼
                       ┌─────────────────────────────────────────┐
                       │  GPU  (every frame, only when dirty)    │
                       │  · bin spans → density (compute+atomic) │
                       │  · reduce → per-track max               │
                       │  · write indirect draw args             │
                       │  · instanced span quads / raster LOD    │
                       │  · selection mask lookup (bitset)       │
                       │  · overlay pass                         │
                       └─────────────────────────────────────────┘

  MAIN THREAD, every frame:  pointer/wheel/key → viewport uniform write (≈64 bytes),
                             CPU hit-test via per-track index (O(log n)),
                             DOM label overlay update (≤400 nodes, keyed, reconciled)
```

**Stays on CPU deliberately:** all string work (formatting, search, collation, label text); the one-time sort; track layout; tooltip content; the a11y tree; and every decision that must be answered *this frame*.

**Never moved to GPU:** per-frame sorting (do it once); anything requiring a blocking readback; small datasets below the crossover.

### 19.2 The optimisation ladder (applied in this order, and only after measurement)

Straight from vgpu's own performance playbook, which we adopt as house style:

1. `timer(gpu)` spans first — CPU timing around `frame.pass()` measures *encoding*, not GPU work. Never optimise a pass we haven't timed.
2. `compile()` pre-warm at mount for every target signature, so the first visible frame doesn't compile a pipeline.
3. `set()` only what changed — vgpu does no equality checking, so hoisting static and resize-class uniforms out of the loop is our job.
4. Instancing over draw loops (already the design).
5. `uniforms(gpu, …)` for values shared across components (time, DPR, theme).
6. `UniformPool` + dynamic offsets when per-object uniform count gets large (the DataGrid's per-column case).
7. Indirect draw/dispatch so GPU-computed counts never round-trip.
8. `bundle()` for static repeated draws (chrome layers, phase 4).
9. `pingPong` for iterative passes without allocating in the loop.

### 19.3 Adaptive quality

The runtime measures frame time and can degrade **with an explicit callback, never silently**: raise the LOD threshold (raster instead of individual spans), clamp DPR toward 1, halve the label budget, skip the overlay pass during an active gesture. Each degradation is reported through `onPerformance` so applications can surface it.

---

## 20. Benchmark Plan

**Methodology is defined before any number is produced. This document contains zero measured results — producing them is the phase 0 deliverable.**

### 20.1 Harness

- **Datasets:** synthetic, seeded, deterministic generators at 1k / 10k / 100k / 1M / 5M / 10M spans, with three shapes: *shallow-wide* (many tracks, few nested), *deep-nested* (flame-graph-like), *bursty* (realistic trace clustering). Committed as generator code + seed, not as fixtures.
- **Environments:** (a) headless Node + Dawn via `vgpu/node` for determinism and CI trend-tracking; (b) `vgpu/node` with the **software renderer** for machine-independent *correctness* snapshots (never for perf numbers — say so in the results); (c) real browsers via Playwright with WebGPU enabled: Chrome/Edge, Firefox (Win + macOS Tahoe ARM), Safari 26+.
- **Hardware tiers, reported separately, never averaged:** integrated (Apple M-series, Intel Iris/Arc), mid discrete (RTX 3060 / RX 6600 class), high discrete.
- **Controls:** fixed `dpr: 1` and explicit `size` for reproducibility; pipelines pre-warmed with `compile()` before timing; 200 warmup frames discarded; report **p50 / p95 / p99 and worst frame**, never the mean; ≥3 runs, report variance.

### 20.2 What we measure, and with what

| Metric | Instrument | Notes |
|---|---|---|
| GPU pass time | `timer(gpu)` spans per pass (`timestamp-query`) | Results arrive 1–2 frames late via `onResults`, in ms; a span times a whole pass, so each pass we care about gets its own |
| GPU frame time | `gpuFrameTime` from `@vgpu/render/perf` | Cross-check against summed spans |
| CPU frame time | `performance.now()` around the frame callback | Explicitly labelled "encode + JS", never called "GPU time" |
| Dropped frames | rAF delta > 1.5 × target interval | Reported as count and as longest stall |
| Interaction latency | `pointermove`/`keydown` timestamp → the `requestAnimationFrame` in which the visual response is submitted | Hover, selection, zoom step, scroll |
| Upload cost | bytes and ms for the initial `flush()` | The number that decides "is GPU worth it at N" |
| CPU memory | `performance.measureUserAgentSpecificMemory()` where available | Best-effort; documented as such |
| GPU memory | **our own accounting** of buffers/textures we allocated | **WebGPU exposes no GPU memory API.** Reported as "allocated by this library", never as "GPU memory used" |
| Draw calls / dispatches | our counters in the scheduler | Exact |

### 20.3 Comparisons

For each dataset size, the same visual output rendered by:

| Baseline | Implementation | Expected honest outcome |
|---|---|---|
| **DOM** | absolutely positioned divs, virtualised | Wins below ~2k spans (no upload cost); unusable above ~10k |
| **Canvas2D** | our own fallback renderer (§22) — same code path, so it's a fair fight | Wins below the crossover; competitive to ~50k; degrades linearly after |
| **WebGL2** | a minimal instanced-quad regl/PixiJS implementation | The most important comparison and the one most likely to be uncomfortable: **WebGL2 instancing is also fast.** We must be honest about where WebGPU actually wins — compute in the data path (binning, reduction, selection), indirect draws, and storage-buffer-driven vertex work, not raw quad throughput |
| **WebGPU (ours)** | `GPUTimeline` | — |

**We publish the WebGL2 comparison even when it is close.** A library that overclaims against WebGL2 loses credibility with exactly the audience that would adopt it.

### 20.4 Provisional targets (hypotheses to be validated or revised in phase 0, not claims)

| Scenario | Target |
|---|---|
| 1M spans, pan/zoom, mid discrete GPU | p95 frame ≤ 8ms, zero dropped frames over a 10s scripted gesture |
| 5M spans, pan/zoom, mid discrete GPU | p95 frame ≤ 16.6ms |
| 10M spans | renders correctly at reduced LOD; degradation is reported, not silent |
| Hover latency, any size | ≤ 16ms (one frame) |
| Initial upload, 1M spans | ≤ 150ms including worker parse, off the main thread |
| Crossover vs Canvas2D | measured and **published in the component docs** |

If phase 0 shows a target is unreachable, **the target changes and the docs say why** — we do not ship an unmeetable number.

---

## 21. Accessibility

A GPU canvas is an opaque pixel buffer. This is the section that decides whether this library is usable in a regulated or enterprise setting, and it is architectural.

### 21.1 The hybrid model

```text
<div role="application" aria-label="Request trace" aria-describedby="tl-summary">
  <canvas aria-hidden="true" />                 ← pixels only, never the semantic source
  <div class="overlay" >                        ← ONE layer: labels AND semantics
     <span role="listitem" tabindex="-1"
           style="transform: translate(…)"      ← positioned by the same viewport transform
           aria-label="fetchUser, 12.4ms, depth 3, track HTTP">fetchUser</span>
     … ≤400 of these, virtualised to the viewport
  </div>
  <div id="tl-summary" class="sr-only">3 tracks, 5,120,000 spans, showing 0–12.4s …</div>
  <div aria-live="polite" class="sr-only" />    ← announcements on focus/selection change
</div>
```

The key architectural decision: **the label overlay and the accessibility tree are the same DOM layer.** They are derived from one view model, positioned by one transform. This means a11y cannot rot, because breaking it breaks the visible labels. It is also why the DOM-label choice in §13.4 is a design decision and not a shortcut.

### 21.2 Concrete requirements for `GPUTimeline`

- **Keyboard:** roving `tabindex`; arrows move between spans within a track and across tracks; `Home`/`End` jump to first/last; `+`/`-` zoom; `PageUp`/`PageDown` pan a screen; `Enter`/`Space` select; `Shift+Arrow` extends selection; `Escape` clears. Focus moves the *viewport* when the focused span leaves it, so keyboard users navigate the whole dataset, not just what's on screen.
- **Screen reader:** each focusable span carries a composed `aria-label` (name, duration, depth, track, timestamp). A summary region describes the whole component and the current domain. `aria-live="polite"` announces selection and domain changes, debounced to one per 500ms.
- **Focus visibility:** the focus ring is drawn *both* as a DOM outline on the overlay element and in the overlay shader pass, so it is visible regardless of which layer the user perceives.
- **Text selection and copy:** the overlay `<span>`s are real text, so selection and copy work natively. `Ctrl/Cmd+C` on a selection copies a tabular text representation of the selected spans.
- **Semantic export:** `ref.current.toAccessibleTable()` returns a real `<table>` of the current view — the escape hatch for AT that cannot handle the canvas at all, and the basis of a "view as table" affordance.
- **Reduced motion:** `prefers-reduced-motion` disables inertial pan/zoom animation; the component still works, it just snaps.
- **Contrast:** default colour ramps are checked against WCAG AA for the text-on-span case; the docs state which ramps are safe.

### 21.3 Testing

`axe-core` in the Playwright suite; a keyboard-only scripted walkthrough asserting focus order and `aria-live` announcements; a manual VoiceOver/NVDA pass before each minor release, recorded in the release checklist.

---

## 22. Fallback Strategy

### 22.1 Detection

vgpu's `init()` throws `VGPU-RING1-UNSUPPORTED` when WebGPU is unavailable or the adapter request returns `null`. We catch it and set `caps.tier`, so unsupported is a **state**, not an exception, and React renders the fallback tree normally.

```text
navigator.gpu present && init() resolves        → tier: 'gpu'
init() throws VGPU-RING1-UNSUPPORTED            → tier: 'fallback'
device lost, recovery failed after N attempts   → tier: 'fallback'
fallback prop = "none"                          → tier: 'none' → render the fallback ReactNode
```

### 22.2 Does every component need a fallback? No.

**Policy: the fallback renders the same four primitives (§12.1) on Canvas2D, at a capped budget, and each component declares its cap.** We do not maintain two full implementations per component — that is the maintenance trap `chartcn` walked into by swapping in an entirely different engine (PixiJS) for the fallback path.

Because the `RenderPlan` primitives are small and declarative, one Canvas2D backend serves every component:

| Primitive | Canvas2D fallback | Cap |
|---|---|---|
| `InstancedQuadLayer` | `fillRect` loop with batched `fillStyle` runs | ~50k quads/frame |
| `LineLayer` | `stroke()` paths | ~20k segments |
| `RasterLayer` | `putImageData` of a CPU-binned density field | full |
| `LabelLayer` | already DOM in both paths — **identical** | ≤400 |
| Compute passes | CPU equivalents for binning/reduction, run in the worker | slower, correct |

Above the cap the fallback **downsamples the data and says so** via `onPerformance({ degraded: true, reason })`. It never silently lies about what it drew.

### 22.3 The public contract

```tsx
<GPUTimeline fallback="canvas2d" />   // default: degraded but functional
<GPUTimeline fallback="none" />       // render nothing; app handles it
<GPUTimeline fallback={<UpgradeNotice />} />
```

Given Baseline WebGPU (Jan 2026), the realistic fallback population is ~5–10%: Linux Firefox, older iOS devices, and locked-down enterprise browsers. That is small enough that a *degraded* fallback is the right investment level and a *parity* fallback is not.

---

## 23. Testing Strategy

vgpu gives us an unusually good testing story and we should exploit all of it.

### 23.1 Unit — `vgpu/mock`, no GPU required, runs everywhere

`vgpu/mock` provides `init()` and `createMockAdapter({ features })`, so the entire runtime is testable in a plain Node test runner:

- Resource lifecycle: mount → unmount → **assert zero live GPU objects**. This is the leak test, and it runs on every commit. Also run as mount → unmount → mount ×100 to catch StrictMode-shaped leaks.
- Scheduler: N components produce exactly one frame; dirty tracking suppresses clean components; compute passes always precede render passes.
- Feature gating: `createMockAdapter({ features: [] })` vs `['timestamp-query']` — assert the profiler degrades correctly rather than throwing.
- `InstanceBuffer` growth, `UniformPool` overflow (`VGPU-UNIFORM-POOL-OVERFLOW`), chunking at `maxStorageBufferBindingSize`.
- View model: track assignment, spatial index correctness against a brute-force oracle, viewport transform round-trips (`time → clip → time`).
- Device-loss replay: simulate loss, assert every buffer is reconstructed and content matches.

### 23.2 Shader — static, in CI, no device needed for the parse/reflect half

- `npx vgpu check ./**/*.wgsl --require-validation` (or `VGPU_VALIDATE=require`) fails the build on invalid WGSL and on module-declares-binding violations (`VGPU-RESOLVE-MODULE-BINDING`).
- **Reflection snapshots:** `check` prints reflection JSON; we commit it and diff. An accidental binding or struct-layout change becomes a reviewable diff instead of a runtime bug.
- Unit-test WGSL helper functions by extracting them into pure modules and comparing against TypeScript reference implementations, using the pattern in vgpu's shader-debugging guide (encode internals as pixels, read back, compare).

### 23.3 GPU correctness — `vgpu/node` (Dawn), plus the software renderer for determinism

- Compute kernels: dispatch, `StorageBuffer.read()`, compare against a CPU reference — exact for integer binning, epsilon-bounded for float reduction.
- Render correctness: `frame(gpu, …)` into an explicit `target()`, `target.read()`, assert on known pixels.
- **`npx vgpu install-software-renderer`** gives machine-independent pixels, which is what makes visual snapshots viable in CI at all. Perf numbers are never taken from it.

### 23.4 Visual regression

`pixelDiff` from `@vgpu/render/perf` against committed baselines rendered through the software renderer. Fixed size, `dpr: 1`, `autoResize: false`, one deterministic `frame()` — never a rAF loop (per vgpu's own test checklist). Corpus: empty, 1 span, dense, deeply nested, all-selected, hover state, extreme zoom in/out, RTL labels.

### 23.5 Integration — React

Testing Library + `vgpu/mock`: props → GPU state, StrictMode double-mount, Fast Refresh, controlled/uncontrolled viewport and selection, error boundary receives `gpu.onError` failures, `gpu.settled()` for deterministic teardown assertions.

### 23.6 Browser matrix — Playwright with WebGPU

Chromium, Firefox (Win/macOS ARM), WebKit/Safari 26+. Smoke render + interaction + `axe-core` per browser. Plus a WebGPU-disabled run asserting the fallback path.

### 23.7 Performance regression

The phase-0 benchmark harness runs nightly on a pinned self-hosted runner; p95 frame time and upload time are tracked with a ±10% regression gate. CI-runner numbers are trend data only, never published as product claims.

---

## 24. Security

### 24.1 Threat model

The realistic threats, ranked:

1. **Untrusted *data* causing GPU denial of service.** This is the real one. A hostile or merely broken dataset with 500M spans, `NaN`/`Infinity` timestamps, or 10^9 tracks can produce an unbounded allocation, an unbounded dispatch, or a hang that takes down the tab (and on some drivers, triggers a TDR that kills every GPU context in the browser).
2. **Untrusted *shaders*** — only if we ever accept runtime WGSL, which v1 does not.
3. **Registry supply chain** — the CLI writes code into a user's repo.
4. **Cross-origin information leakage** via timing side channels.

### 24.2 Mitigations for untrusted data (v1, mandatory)

- **Validate at ingest, in the worker, before anything touches the GPU:** finite numbers only; `dur >= 0`; `track < trackCount`; ids unique. Invalid rows are dropped with a counted, reported reason, never silently.
- **Hard budgets from device limits, not constants:** span count is capped against `maxStorageBufferBindingSize` / stride, with chunking above it and a typed `GpuBudgetExceededError` (carrying requested vs available bytes) above the total budget. No silent truncation.
- **Clamp every dispatch** against `maxComputeWorkgroupsPerDimension`. Compute a dispatch count from data, then clamp, then assert — an unclamped `dispatchWorkgroups` derived from user data is the easiest GPU hang to write.
- **Validate indirect args are only ever written by our own kernels.** Indirect buffers are never exposed in the public API. vgpu validates structural correctness (`VGPU-INDIRECT-INVALID`: offset alignment, buffer size, indirect usage flag), but the *values* are ours to bound: the clamping happens in the kernel that writes them.
- **Bound the label budget** so a dataset with 10M one-character spans cannot generate 10M DOM nodes.
- **Never NaN-propagate into the viewport transform** — a NaN uniform can blank the entire canvas; validate the transform every write in dev builds.

### 24.3 Shader and supply-chain posture

- **No runtime-compiled user WGSL in v1.** Shaders are build-time artefacts, validated in CI by `npx vgpu check`. If we ever add user shaders (a plugin API), they get their own device with conservative limits, a compile timeout, and a documented "this is equivalent to running untrusted code in your page" warning.
- **No string-concatenated WGSL from user input.** WGSL specialisation uses `constants` (WGSL `override`), which vgpu supports on both `draw` and `compute` — a typed, non-injectable mechanism. This is a hard rule.
- **Registry integrity:** every registry item ships a SHA-256; the CLI verifies before writing; `add` prints the file list and requires confirmation outside CI; the registry is served over HTTPS from a versioned, immutable path. (vgpu's own examples API uses exactly this immutable-artefact + published-SHA pattern; we copy it.)
- **Community components (phase 7)** are reviewed source in a monorepo with mandatory review, not an open upload endpoint. The shadcn model's security property is that *users read the code before it runs* — we preserve that by keeping components small and readable, and by making `add` show what it wrote.

### 24.4 Browser sandbox limits, stated honestly

WebGPU's sandbox prevents cross-process memory access, but it does **not** prevent a page from hanging its own GPU work or exhausting VRAM, and driver-level TDR recovery is outside our control. Our defence is budget enforcement, not hope. Timing side channels are mitigated by the browser's timer coarsening; we add nothing and claim nothing there.

---

## 25. Repository Structure

```text
gpu-components/
├── apps/
│   ├── docs/                  Next.js docs site + live examples (WGSL loader configured — doubles as the reference integration)
│   ├── playground/            interactive perf sandbox (§27)
│   └── bench/                 benchmark harness: generators, runners, reporters (§20)
│
├── packages/
│   ├── core/                  framework-free runtime. deps: vgpu
│   │   └── src/{runtime,scheduler,plan,resources,capabilities,profiler,
│   │             picker,viewport,interaction,fallback-canvas2d}/
│   ├── react/                 adapter. deps: core, react (peer)
│   ├── wgsl/                  shared WGSL modules — structs + fns only. deps: none
│   ├── testing/               harness over vgpu/mock, vgpu/node, @vgpu/render/perf. dev-only
│   └── cli/                   add / diff / doctor / list
│
├── registry/
│   ├── registry.json          shadcn-compatible registry schema
│   └── timeline/              the component source that `add` copies
│       ├── GPUTimeline.tsx  TimelineRenderer.ts  viewModel.ts
│       ├── interaction.ts   a11y.ts  fallback.ts  types.ts
│       └── shaders/{spans,bin,overlay}.wgsl
│
├── tests/
│   ├── e2e/                   Playwright: browser matrix, a11y, fallback
│   └── snapshots/             visual baselines (software-renderer rendered)
│
└── tooling/                   eslint config (incl. the no-react-in-core rule),
                               tsconfig bases, wgsl typegen, release scripts
```

**Why each package exists — and what was cut from the brief's sketch:**

| Package | Justification |
|---|---|
| `core` | The product. Framework-free by CI enforcement |
| `react` | Adapter only. Kept separate so `core`'s independence is structural, not aspirational |
| `wgsl` | Must be a package because vgpu resolves WGSL package imports through `node_modules`, and because module-level binding declarations are forbidden — a package boundary makes that rule enforceable |
| `testing` | Shared harness; keeps `vgpu/node`/Dawn out of consumers' dependency trees |
| `cli` | Distribution |
| ~~`renderer`~~ | **Cut.** vgpu's `draw`/`effect` *are* the renderer; a wrapper package would be a pass-through with a version number |
| ~~`runtime`~~ | **Cut.** Merged into `core`; splitting invites a dependency cycle for no benefit |
| ~~`shaders`~~ | **Cut.** Split into `packages/wgsl` (shared, ours) and per-component shaders (copied, the user's) |
| ~~`components`~~ | **Cut.** Components are registry source, not an npm package (§18) |
| ~~top-level `shaders/`~~ | **Cut.** Shaders live next to the code that binds them; vgpu's loader resolves relative imports |

---

## 26. Documentation Strategy

Every component page carries the same 15 sections, in this order. Two of them are the differentiator and are non-optional:

```text
Overview · Why GPU? · When to use · **When NOT to use** · Installation · Quick start ·
API · Examples · **Performance (with measured crossover)** · Architecture · Accessibility ·
Browser support · Limitations · Source · Shader source · Benchmarks
```

- **"When NOT to use"** is mandatory and specific: *"Below ~30,000 spans, a Canvas2D timeline is faster end-to-end because upload cost dominates. Use `<Timeline>` from X or a plain canvas. Here is the measurement."* A library that only tells you to use it is marketing.
- **"Performance"** links to the live playground with the exact dataset preloaded, so claims are reproducible in the reader's own browser on their own hardware.
- **"Shader source"** renders the actual `.wgsl` with reflection-derived binding docs — teaching material, not an appendix.

Beyond component pages, a **"Deciding whether you need the GPU"** guide is the library's opinionated centrepiece: the crossover table across all components, the cost of upload, why Canvas2D is better than you think, why WebGL2 is still competitive for pure quad throughput, and where WebGPU actually wins (compute in the data path, indirect, storage-buffer-driven vertex work). This guide is the thing that earns trust with senior engineers, and it is also a genuine SEO/word-of-mouth asset.

Architecture docs mirror §9–§14 so contributors don't have to reverse-engineer the runtime, and an explicit **"What vgpu does vs what we do"** page (the §9.2 table) prevents the most likely contributor mistake: reimplementing something vgpu already provides.

---

## 27. Playground

A single-page app where the GPU benefit is demonstrated rather than asserted.

**Controls:** dataset size (1k → 10M, log slider) · dataset shape (shallow/nested/bursty) · renderer (**WebGPU / Canvas2D / DOM**, live-switchable on the same data) · DPR · LOD threshold · label budget · colour ramp · a scripted-gesture button that replays an identical pan/zoom sequence in every mode so comparisons are fair.

**Live readout** (only real metrics, §28): FPS + p95 + worst frame · CPU encode ms · GPU pass ms per pass (when `timestamp-query` is available; greyed out with a tooltip when not) · draw calls · dispatches · spans drawn vs. spans in dataset · buffer bytes allocated by the library · upload time for the last dataset change.

**The money shot:** the renderer toggle. Same data, same gesture, side by side — DOM dies at 10k, Canvas2D degrades at 100k, WebGPU is flat to 5M. That single interaction is the strongest argument this project can make, and it is also an honest one because the toggle also shows where WebGPU *isn't* faster at small N.

**Deep-link state** so any doc page, issue, or benchmark claim can link to the exact configuration that produced it.

---

## 28. Developer Tooling

### 28.1 What WebGPU actually exposes — and what it does not

The brief's sketched inspector lists "Approx GPU memory". **WebGPU has no GPU memory API.** Being precise here matters, because inventing telemetry is the fastest way to lose credibility with the audience that would use this tool.

| Metric | Available? | Source |
|---|---|---|
| Adapter vendor / architecture / device | **Partially** — `adapter.info` is intentionally coarse and may be masked/quantised for privacy | `GPUAdapterInfo` |
| Device limits & features | **Yes, exactly** | `device.limits`, `device.features` |
| Per-pass GPU time | **Yes**, with the `timestamp-query` feature | `timer(gpu).span(name)` → `onResults`, ms, 1–2 frames late |
| Whole-frame GPU time | **Yes** | `gpuFrameTime` (`@vgpu/render/perf`) |
| Per-**draw** GPU time | **No** — a span times a whole pass | Isolate by moving the draw into its own pass |
| Occlusion / visible-sample counts | **Yes** | `visibility(gpu)` occlusion queries |
| Draw calls, dispatches, passes | **Yes** — *our* counters | Scheduler instrumentation |
| Buffer/texture count and bytes | **Yes for what we allocated** | `ResourceRegistry` accounting. Labelled "allocated by this library", never "GPU memory used" |
| Actual VRAM usage, driver counters, shader occupancy | **No** | Not exposed by WebGPU. The inspector says "not available in WebGPU" rather than estimating |
| Pipeline cache hits/misses, compile time | **Yes, ours** | We wrap `compile()`/`compileSync()` timing |

### 28.2 The inspector (phase 4, ships as a dev-only React component + a devtools-style panel)

```text
GPU Inspector                                    [runtime: 1 device, 3 surfaces]
├─ Device
│   ├─ Adapter        (as reported; may be masked by the browser)
│   ├─ Features       timestamp-query ✓  float32-filterable ✗
│   └─ Limits         maxStorageBufferBindingSize 128 MiB …
├─ Frame              CPU encode 1.9ms · GPU 6.2ms · p95 7.4ms · dropped 0/600
│   └─ Passes         bin 1.1ms · reduce 0.2ms · spans 4.1ms · overlay 0.8ms
├─ Components         timeline#1  dirty ✓  2 passes  1 indirect draw  1.2M instances
├─ Resources          buffers 7 (48.2 MiB allocated by this library) · textures 2 (1.1 MiB)
│                     pipelines 5 · cache misses this session 5
└─ Warnings           "InstanceBuffer grew 3× in 60 frames — presize with `capacity`"
                      "set() called with unchanged uniform 60×/s — hoist out of the loop"
```

The **warnings pane is the highest-value part** and it is cheap: it encodes vgpu's documented anti-patterns (uniform writes with no change, targets created in the loop, pipelines compiled during a frame, buffers growing repeatedly, unbatched draws) as automatic detections. It teaches the performance model instead of requiring the docs to.

---

## 29. Roadmap

### Phase 0 — Research & validation *(1 week)*

**Goals:** prove the two load-bearing assumptions before writing the runtime — (a) one device / many canvases / one submit works and is faster than N devices; (b) 5M instanced quads is actually achievable.
**Deliverables:** spike repo; the benchmark harness skeleton (`apps/bench`) with generators and the reporting format; measured baselines for DOM / Canvas2D / WebGL2 at every dataset size; a decision record on canvas-per-component vs mega-canvas.
**Files:** `apps/bench/**`, `spikes/**`.
**Dependencies:** vgpu, a machine of each hardware tier.
**Risks:** the 5M target proves unreachable → revise targets publicly, or reduce span stride (32B → 20B) and re-measure.
**Acceptance:** benchmark harness runs headless in CI and in three browsers; baseline numbers committed with methodology.
**Benchmark criteria:** all §20.3 baselines measured at all sizes; the numbers, not the hopes, set the phase-4 targets.

> **Status note:** this phase was skipped in initial implementation — Phase 1–3 code landed with no
> `apps/bench`, no baselines, and no CI, despite this section gating Phase 1 on "phase 0 decisions."
> Backfilled afterward: `apps/bench/` now exists with the harness, generators, and four real
> renderers; real (not hypothetical) baseline numbers are committed at
> `apps/bench/results/BASELINES.md`, and the canvas-per-component-vs-mega-canvas decision record at
> `apps/bench/results/decision-record.md`. Scope actually delivered vs. the full spec above — one
> hardware tier (not three), Chromium only (not three browsers, though declared/commented-out for
> Firefox/WebKit in `playwright.config.ts`), no interaction-latency or memory accounting — is
> documented honestly in that file's own "Methodology" and "Not yet measured" sections and in
> `apps/bench/README.md`, not silently claimed as complete here.

### Phase 1 — GPU runtime *(2 weeks)*

**Goals:** `@gpu-components/core` + `@gpu-components/react`, minimum viable.
**Deliverables:** `GpuRuntime`, `FrameScheduler`, `RenderPlan`, `ResourceRegistry`, `TargetPool`, `InstanceBuffer`, `Capabilities`, device-loss recovery, `Profiler` (timestamp-query gated), `GPUProvider` / `useGpu` / `useGpuCanvas` / `useGpuComponent`, `packages/wgsl` v1 modules, the `vgpu/mock` test harness.
**Files:** `packages/core/**`, `packages/react/**`, `packages/wgsl/**`, `packages/testing/**`.
**Dependencies:** phase 0 decisions.
**Risks:** scheduler reentrancy against `VGPU-FRAME-REENTRANT`; StrictMode leaks.
**Acceptance:** two trivial components on one page → one device, one submit; mount/unmount ×100 → zero leaked resources; `core` builds with React uninstalled; simulated device loss recovers.
**Benchmark criteria:** scheduler overhead < 0.3ms/frame for 10 mounted components.

### Phase 2 — First component: `GPUTimeline` *(3 weeks)*

**Goals:** a real, useful timeline.
**Deliverables:** worker ingest → columnar arrays; `InstancedQuadLayer`; viewport model; LOD binning compute + indirect draw; overlay pass; DOM label overlay; the a11y semantic layer; the registry entry + CLI `add`.
**Files:** `registry/timeline/**`, `packages/core/src/{viewport,picker}/**`, `packages/cli/**`.
**Dependencies:** phase 1.
**Risks:** label overlay reconciliation cost at 400 nodes/frame; LOD threshold tuning.
**Acceptance:** 1M spans render correctly; pan/zoom smooth; labels correct at every zoom; keyboard navigation complete; `axe-core` clean; `npx gpu-components add timeline` works in a fresh Vite and a fresh Next.js app.
**Benchmark criteria:** 1M spans p95 ≤ 8ms; upload ≤ 150ms; measured Canvas2D crossover published.

> **Status note (2026-08-30, audited against real code, not commit messages):** partially shipped.
> Done: `InstancedQuadLayer` + viewport model (`a7153d5`), CPU hit-testing + hover/select (`be0d474`),
> and a genuinely thorough accessibility/keyboard-nav layer (`3d7943c`) — `role="application"`,
> `aria-activedescendant`, an `aria-live` announcer, keyboard traversal over the *full* dataset via
> `hitTest.ts`, and the DOM label overlay doubling as the a11y tree, exactly as designed in §21. Time
> precision was audited and fixed as part of resolving open question #3 above.
> **Updated (2026-08-30):** the compute pass / indirect draw gap is closed, partially. Added
> `registry/timeline/cull.wgsl.ts` — a compute pass, one invocation per span, that culls to the
> current viewport's time range and compacts survivors into `visibleIndices` via an atomic append,
> writing the append count straight into a `drawIndirect` args buffer (`InstancedQuadLayer` gained a
> `drawIndirect()` method and an `instances` getter for this). `TimelineComponent.plan()` now
> declares that compute pass, and the render pass draws through it — no more "every span, every
> frame," and the "Indirect dispatch/draw" row of §8.2's subsystem table is now exercised. Verified
> against `vgpu/mock` (wiring/binding correctness — atomics, bind-by-name, no `VGPU-*` errors — not
> pixel-level culling correctness, which needs `vgpu/node`/browser testing, not yet done).
> **Updated (2026-08-30): the density-field LOD binning gap is now closed too.** Added
> `densityBin.wgsl.ts` (one thread per span, atomically bucketing it into a `trackCount ×
> PIXEL_COLUMNS(512)` density grid by its *start time* only — a stated, bounded approximation, not a
> full per-span coverage scan; see that file's doc comment), `reduceDensity.wgsl.ts` (per-track max,
> for independent color normalization per track), `raster.wgsl.ts` (a full-screen `effect()` fragment
> shader reading the density/max buffers directly — no `GPUTexture` involved, see
> `packages/core/src/layers/rasterLayer.ts`'s doc comment for why), and `RasterLayer`, the fourth
> §12.1 core primitive, alongside `InstancedQuadLayer`. `TimelineComponent` now runs a CPU-only LOD
> heuristic each `update()` (`estimateSpansPerPixelColumn` vs. a `lodThreshold` constructor option,
> default 4 per §31 open question #4) and `plan()` branches its `computePasses`/render encoding
> between the existing visibility-cull+indirect-draw path and this new density-raster path — no GPU
> readback in the decision itself. Verified against `vgpu/mock` (wiring/binding correctness) *and* a
> real headless-Chromium WebGPU backend (`apps/bench/tests/sharedContextOnly.spec.ts`, which exercises
> this code path with real payload every frame) — the new shaders compile and run for real, not just
> against the lenient mock.
> **Still missing:** the CLI `add` deliverable (no `packages/cli`, no `registry.json` anywhere in the
> repo — that work hasn't started; treat it as still-Phase-6-scoped, not a Phase-2 regression). The
> LOD heuristic itself is a CPU estimate, not measured against real frame-time data — tuning
> `lodThreshold`'s default empirically (as §31 open question #4 asks) needs the Phase 4 benchmark
> work, not done here.

### Next phase — closing out Phase 2 before touching Phase 3/4/5 work

**Do not skip ahead to Phase 3/5 items while Phase 2's own acceptance criteria are unmet.** The
next concrete slice of work, in order (updated 2026-08-30):

1. ~~Time-precision spike (`spikes/gpu-time-precision.md`) and the resulting `ingest.ts`/
   `TimelineComponent.ts` fix~~ — **done, 2026-08-30** (see open question #3 above). Was a real,
   present-day correctness bug (up to 1s of error at epoch scale), not a hypothetical risk.
2. ~~Time-range visibility-cull compute pass + indirect draw for `TimelineComponent`~~ — **done,
   2026-08-30** (`cull.wgsl.ts`, `InstancedQuadLayer.drawIndirect()`). ~~Density-field binning +
   `RasterLayer` compositing for extreme zoom-out~~ — **also done, 2026-08-30**
   (`densityBin.wgsl.ts`, `reduceDensity.wgsl.ts`, `raster.wgsl.ts`, `RasterLayer`, and the CPU-only
   `estimateSpansPerPixelColumn` LOD switch in `TimelineComponent.plan()`). PLAN.md §12.2's full
   two-mode Timeline frame is now implemented end to end. `RasterLayer` is the prerequisite primitive
   for Phase 5's `GPUHeatmap` reuse test; brush-selection's GPU bitset mask (Phase 3) is still open.
3. ~~Investigate the unconfirmed "one device beats N devices" result~~ — **investigated across two
   rounds, 2026-08-30** (`apps/bench/results/decision-record.md`). **Round 1:** root cause found and
   fixed — the benchmark measured bare `requestAnimationFrame` cadence, not the runtime;
   `GpuRuntime.invalidate()` only marks surfaces dirty, not components, so the scheduler's `active`
   list was empty for every "measured" frame in both configurations and nothing was ever encoded or
   submitted. The original "shared is worse" reading was a single anomalous dropped frame in an
   otherwise fully-idle loop, not a real finding. **Round 2:** gave each component real (small)
   payload driven every frame through an oscillating-viewport `update()` (matching
   `renderers/webgpu.ts`'s own pattern, replacing the Round-1 `animating` shortcut), and pushed
   component/device count to 24 (committed) and spot-checked to 48. **Result: still inconclusive,
   more thoroughly this time** — every configuration at every count from 2 to 48 ties at the vsync
   floor. Root cause is now understood, not just observed: `requestAnimationFrame`-interval
   measurement has a hard floor at the display's vsync rate and cannot show a sub-vsync difference no
   matter how much payload or how many devices, until total per-tick work actually exceeds one
   frame's budget — which nothing tried so far does. **What would actually produce a signal:**
   bracket the encode/submit step directly with `performance.now()` (bypassing vsync), or use
   `vgpu`'s `timer(gpu)` GPU timestamp-query spans — i.e. build the Phase 4 `Profiler` (§10.7),
   currently not implemented, before attempting this measurement again. Recorded honestly: the
   founding claim is still neither confirmed nor contradicted.
   > **Round 3 (2026-08-30): confirmed.** §10.7's `Profiler` is built and wired into
   > `FrameScheduler`/`GpuRuntime`; `apps/bench/src/harness/gpuTimingScenario.ts` re-ran this
   > investigation with real per-pass GPU timing (`timer(gpu)`, bypassing the vsync floor entirely)
   > instead of `requestAnimationFrame`-interval measurement. **Result: the shared runtime costs
   > meaningfully, reproducibly less real GPU time per tick than N independent devices doing the same
   > aggregate work**, from N=8 components onward (N=2 is noise-level, both configs' cost is tiny) —
   > ratios from 1.6× to 2.5× across N=8/16/24, reproduced consistently across five separate runs.
   > See `apps/bench/results/decision-record.md`'s "Round 3" section for the full numbers, including
   > an honestly-reported non-monotonicity (the ratio narrows at N=24 vs. N=16) whose cause hasn't
   > been investigated. **PLAN.md §2(a)/§11's founding claim — "one device across N components" — is
   > now confirmed, not merely un-contradicted**, after three rounds: harness bug (Round 1) →
   > methodology ceiling (Round 2) → real signal (Round 3).
4. Both Phase 3 (inertial pan, brush selection with a GPU bitset mask) and Phase 2's CLI item are
   done or tracked elsewhere; see those sections' own status notes. The founding-claim investigation
   (item 3) is now closed — confirmed. Phase 4 is now underway — the `Profiler` core primitive
   (§10.7) shipped 2026-08-30 and was immediately put to use closing item 3. Not yet started: the
   React `<GpuInspector>` panel + warnings pane (§28.2, the UI layer over the `Profiler` data that
   now exists); compute-pass GPU timing; adaptive quality; `bundle()` for static chrome; the glyph
   atlas; the nightly perf regression gate; empirically tuning `lodThreshold`'s default (§31 open
   question #4, currently `4`, not yet measured against real frame-time data — the `Profiler` also
   unblocks this); investigating the Round 3 N=24 non-monotonicity, if it turns out to matter.

### Phase 3 — Interaction *(1.5 weeks)*

**Goals:** the interaction primitives, in `core`, reusable.
**Deliverables:** pointer/wheel/keyboard/touch state machines; inertial pan/zoom (reduced-motion aware); CPU hit-testing via the per-track index; async GPU ID-buffer picking as an opt-in path; brush and lasso selection with a GPU bitset mask; controlled/uncontrolled viewport and selection.
**Files:** `packages/core/src/interaction/**`, `picker/**`, `registry/timeline/interaction.ts`.
**Risks:** touch/trackpad gesture normalisation across browsers (historically the buggiest area); async picking latency.
**Acceptance:** hover ≤16ms at 5M spans; brush-select 100k spans without a frame drop; gestures behave identically in all three engines.
**Benchmark criteria:** interaction latency table across all sizes and browsers.

> **Status note (2026-08-30): inertial pan shipped.** Added
> `packages/core/src/interaction/inertia.ts` (`createVelocityTracker`/`decayVelocity` — pure
> kinematics, no rAF loop or event listeners, same DOM-agnostic shape as `wheel.ts`/`pointer.ts`) and
> wired it into `GPUTimeline.tsx`: wheel events feed the tracker, `WHEEL_IDLE_MS` after the last one
> a `requestAnimationFrame` loop decays the velocity and keeps panning until it settles below
> `INERTIA_STOP_VELOCITY`, honoring `prefers-reduced-motion` (no animation at all when set, per
> §21/§32) and cancelled by any new wheel gesture, keyboard pan/zoom, or unmount. Zoom momentum was
> deliberately not implemented — unusual UX (most map/timeline UIs only animate pan momentum) and not
> asked for by this section's own wording ("inertial pan/zoom" describes the gesture pair the
> feature applies to, not a requirement that zoom itself gets momentum). Covered by real
> `core`-level unit tests (pure math) and a jsdom integration test in `GPUTimeline.test.tsx` that
> dispatches real wheel events and observes continued panning after the gesture ends, plus the
> reduced-motion branch — this also caught and fixed a real latent bug in the shared jsdom test
> harness (`GPUProvider.test.ts`/`GPUTimeline.test.tsx`'s mocked `requestAnimationFrame` was passing
> `Date.now()`'s epoch-millis clock instead of the spec's `performance.now()`-based
> `DOMHighResTimeStamp` — harmless until something first depended on the callback's timestamp
> argument, which this feature is the first to do).
> **Update (2026-08-30): brush selection shipped too.** Added `brushSelect.wgsl.ts` (one compute
> pass, one invocation per span, `atomicOr`s a bit into a packed `selectionMask` — 1 bit/span, 32/word
> — when the span overlaps the brush's time range and track range) and wired it end to end:
> `timeline.wgsl.ts` gained an `isSelected()` bit-test read directly in the existing render shader (no
> separate draw, no CPU set, matching §9.5's stated "Hybrid" model exactly), `hitTest.ts` gained
> `selectSpansInRange` (a deliberately simple per-track linear scan — correct over clever, since it
> runs once per gesture end, not per frame) for the final id set an app's `onBrushSelectionChange`
> receives, and `GPUTimeline.tsx` gained a click-drag gesture (built on `pointer.ts`'s existing
> `onDown`, unused until now) with a lightweight DOM selection-box overlay during the drag. **Scoped
> to an axis-aligned rectangle, not true lasso** — a Timeline's 2D grid (discrete track rows ×
> continuous time) doesn't need polygon containment; PLAN.md's own wording treats "brush/lasso" as
> interchangeable, describing a region test either way. Verified against `vgpu/mock` (the
> `atomicOr`/bitset wiring) and a jsdom integration test dispatching real pointer drag events, plus a
> plain-click-still-uses-`onSelect` regression case.
> **Still open, all deliberately out of Timeline's scope:** touch gesture state machines (Phase 3's
> own stated "historically buggiest" deferred risk) and async GPU ID-buffer picking (an opt-in path
> for *future* components without a cheap CPU index — Timeline already has one, so it was never
> needed here). With inertial pan and brush selection both done, **Phase 3's Timeline-relevant
> deliverables are complete.**

### Phase 4 — Performance & tooling *(2 weeks)*

**Goals:** hit or publicly revise the targets; ship the inspector.
**Deliverables:** GPU inspector + warnings pane; adaptive quality; `bundle()` for static chrome; glyph atlas (v2 text) if label budget demands it; the nightly perf regression gate; the full published benchmark report.
**Risks:** WebGPU-vs-WebGL2 results are closer than hoped → we publish them anyway and sharpen the positioning toward compute-in-the-data-path.
**Acceptance:** 5M spans p95 ≤ 16.6ms on mid discrete; regression gate live; inspector detects all five documented anti-patterns.

### Phase 5 — Component expansion *(4 weeks)*

**Goals:** prove runtime reuse. **This is the phase that validates or falsifies the whole architecture.**
**Deliverables:** `GPUHeatmap` (raster + colormap + GPU binning) and `GPUDataGrid` (glyph atlas, TanStack Table integration as a renderer, GPU-side sort/filter/aggregate, conditional formatting, in-cell sparklines).
**Acceptance criterion, stated as a falsifiable claim:** **`GPUHeatmap` requires zero changes to `core`.** If it does not, the runtime abstraction was wrong and we fix it before the DataGrid, not after.
**Benchmark criteria:** DataGrid vs glide-data-grid vs AG Grid on scroll, sort-1M, filter-1M, and conditional formatting — published honestly, including where we lose.

### Phase 6 — CLI & distribution *(1.5 weeks)*

**Goals:** installation is boring and reliable.
**Deliverables:** `add`/`diff`/`doctor`/`list`; shadcn-compatible `registry.json`; bundler auto-config for Vite / webpack / Turbopack; integrity verification; templates for Vite, Next.js App Router, and Remix.
**Acceptance:** a fresh app goes from `npm i` to a rendering component in under five minutes, verified by a scripted e2e test on all three bundlers.

### Phase 7 — Ecosystem *(ongoing)*

Docs site, playground, contribution guide, component RFC process, community registry with mandatory review, and the additional components (`GPUScatter`, `GPUGraph`, flame-graph variant).

---

## 30. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **WebGPU's advantage over WebGL2 is smaller than assumed** for pure quad throughput, undermining the headline claim | **High** | High | Measure in phase 0, before building. Position on *compute in the data path*, indirect draws, and storage-buffer-driven vertex work — not raw fill rate. Publish the WebGL2 comparison even when it's close |
| 2 | Text rendering swallows the schedule | Medium | High | Component chosen specifically to bound it; DOM labels in v1; glyph atlas deferred to phase 4 |
| 3 | vgpu is young; a breaking change or a missing capability blocks us | Medium | High | Pin exact versions; keep vgpu usage inside `core` behind our own interfaces so a change is a one-file fix; `gpu.gpu`/`gpu.device` escape hatches exist for anything vgpu doesn't expose; contribute upstream rather than fork |
| 4 | Device loss / driver TDR in production | Medium | Medium | vgpu does not recover devices — we own it (§10.6), and the CPU-source-of-truth rule in §14 exists for exactly this |
| 5 | The runtime abstraction is wrong and component #2 needs `core` changes | Medium | High | Phase 5 makes this a falsifiable acceptance criterion, discovered at week ~14 rather than at v1.0 |
| 6 | shadcn-copied components drift and generate unreproducible bug reports | High | Medium | Version headers, `diff` command, issue template requires `diff` output |
| 7 | Accessibility proves impractical at scale (400 DOM nodes/frame reconciliation cost) | Medium | High | Measured in phase 2; fallbacks: reduce label budget, use `content-visibility`, or virtualise more aggressively. The a11y-and-labels-are-one-layer design means we can't quietly drop it |
| 8 | `chartcn`/ChartGPU expand into grids/timelines first | Medium | Medium | Our moat is the runtime + a11y + fallback + compute path, which are architectural and slow to copy. Ship the runtime publicly early |
| 9 | Browser inconsistency (Safari/Firefox WebGPU maturity) | Medium | Medium | Playwright matrix from phase 1, not phase 6. Capability gate handles missing features rather than assuming Chrome |
| 10 | Scope creep into "a general 2D GPU renderer" (i.e. rebuilding PixiJS) | **High** | High | The four-primitive rule (§12.1) is a hard architectural boundary; anything needing a fifth primitive needs an RFC |
| 11 | Maintainer bandwidth: a runtime + N components + CLI + docs + registry is a lot of surface | High | Medium | Components are copied source (small maintained surface); one component at a time; no framework adapters in v1 |
| 12 | Nightly perf numbers on CI runners get quoted as product claims | Medium | Low | Label them "trend only" in the output itself; product claims come only from the pinned hardware tiers |

---

## 31. Open Technical Questions

To be resolved in phase 0/1, each with a proposed default so nothing blocks:

1. **Canvas-per-component vs one mega-canvas.** *Default: canvas-per-component.* Resolve by measuring N-swapchain cost at N=1,3,6,12 and comparing against the layout complexity of a mega-canvas with scissor rects.
2. **Optimal span stride.** 32B (`f64 start`, `f32 dur`, `u16 track`, `u8 depth`, `u8 cat`, `u32 id`, padding) vs 20B with quantised time. Directly determines the max-span ceiling under `maxStorageBufferBindingSize`. *Default: 32B; measure the quantisation error at extreme zoom before shrinking.*
3. **`f64` time on the GPU.** WGSL has no `f64`. Traces span nanoseconds to hours, so we must split time into a two-`f32` (hi/lo) representation or rebase against a per-viewport origin. *Default: rebase per viewport to `f32` relative time — simpler and sufficient — but validate precision at 1ns resolution over a 24h trace.* **This is the single most likely source of subtle visual bugs and should be spiked first.**
   > **Resolved (2026-08-30), see `spikes/gpu-time-precision.md`.** Measured, not assumed: the code as
   > shipped through commit `4e3c7b4` did *no* rebasing at all — `SpanBuffers` narrowed absolute
   > (epoch-scale) time to `f32` at ingest, and `TimelineComponent` fed the raw absolute viewport into
   > `viewportUniforms()`. Measured error at epoch scale: up to **1 second** for a 1-second time
   > difference — a live, present-day bug, not a hypothetical one. Shipped fix: a **dataset-local
   > origin**, computed once per dataset (`computeOrigin`, `min(start)` across all tracks) and
   > subtracted before the f32 narrowing, applied consistently to both the packed GPU buffers and the
   > viewport uniforms. Measured error after the fix: ~0 near the origin, rising to low-millisecond
   > at the far edge of a 24h dataset — about 1000× better than before, but *not* the literal "1ns
   > over 24h at any zoom" target, which requires a dynamic per-viewport hi/lo (two-f32,
   > compensated-subtraction) representation that was **not** implemented (bigger lift: buffer-layout
   > change + shader math change; not required by any §32 acceptance criterion). Deferred to
   > whichever of the LOD-binning work or a real ns-precision consumer request comes first.
4. **LOD crossover threshold** — spans-per-pixel-column at which we switch from instanced quads to the raster density field. *Default: 4; tune empirically, expose as a prop.*
5. **Async GPU picking latency budget.** One frame late is acceptable for hover; is it acceptable for click? *Default: CPU hit-test for click (exact, immediate), GPU picking only for layers without a CPU index.*
6. **DOM label reconciliation cost at 400 nodes/frame.** *Default: keyed pooling with `transform`-only updates; measure and fall back to fewer labels or a canvas text layer.*
7. **Worker transfer strategy** — `Transferable` (zero-copy, source detached) vs `SharedArrayBuffer` (requires COOP/COEP headers, which many apps cannot set). *Default: Transferable; SAB as an opt-in for apps that already have the headers.*
8. **Does `bundle()` help the Timeline at all**, given nearly everything is dynamic? *Default: no in v1; re-evaluate when static chrome layers exist.*
9. **Multi-provider dedupe key.** How do two independently-mounted providers agree to share a device? *Default: an explicit opt-in `deviceKey` prop; implicit sharing is too magical.*
10. **Where does the a11y overlay live in the DOM** relative to the canvas for correct focus order and hit-testing (pointer-events management, stacking, `inert`)? Needs a spike with real AT.
11. **Colour management.** Surfaces default to `srgb` with `premultiplied` alpha; do we render in linear and convert, or stay in sRGB? *Default: linear working space, convert in the fragment shader (`@vgpu/wgsl-std/color`), because colormap interpolation in sRGB is visibly wrong.*
12. **Does `vgpu/scene` ever become useful to us?** *Default: no. Documented as an explicit non-goal so contributors don't reach for it.*

---

## 32. MVP Acceptance Criteria

### Architecture
- [ ] Exactly **one** `GPUDevice` per `<GPUProvider>`, asserted by test with 6 components mounted.
- [ ] Exactly **one** command-buffer submit per rAF tick regardless of component count.
- [ ] No unnecessary WebGPU contexts: one `Surface` per canvas, disposed on unmount.
- [ ] Deterministic resource lifecycle: `create` → `update`* → `dispose`, with `dispose()` idempotent.
- [ ] **Zero GPU resource leaks** across 100 mount/unmount cycles including StrictMode double-invocation, verified in `vgpu/mock`.
- [ ] `@gpu-components/core` builds and passes its full suite with `react` not installed.
- [ ] Simulated device loss recovers to a rendering state without application involvement.
- [ ] `RenderPlan` declares `reads`/`writes` (unused in v1) so the frame-graph upgrade path is open.

### Performance *(thresholds finalised at the end of phase 0 and published with methodology)*
- [ ] 1M spans: p95 frame ≤ 8ms, mid discrete GPU, scripted pan/zoom.
- [ ] 5M spans: p95 frame ≤ 16.6ms, same conditions.
- [ ] Hover latency ≤ 16ms at every dataset size.
- [ ] Initial upload of 1M spans ≤ 150ms, entirely off the main thread.
- [ ] Scheduler overhead < 0.3ms/frame with 10 mounted components.
- [ ] The measured Canvas2D crossover point is **published in the component docs**.
- [ ] No unbounded memory growth over a 10-minute soak with continuous interaction.

### Developer experience
- [ ] `npm i @gpu-components/core @gpu-components/react && npx gpu-components add timeline` → a rendering `<GPUTimeline />` in **under five minutes**, verified by scripted e2e on Vite, Next.js (App Router), and Remix.
- [ ] Full TypeScript types; no `any` in the public API; uniform structs generated from WGSL reflection.
- [ ] `npx gpu-components doctor` diagnoses a missing WGSL loader and prints the exact config to add.
- [ ] Every vgpu error reaching the app is a structured `VGPU-*` code with `fix`/`where` preserved, not a swallowed exception.

### Accessibility
- [ ] Fully keyboard navigable, including navigating **outside the current viewport**.
- [ ] `axe-core` clean in all three browser engines.
- [ ] Screen-reader walkthrough (VoiceOver + NVDA) completes the core tasks: find a span, read its details, select it, understand the summary.
- [ ] Labels are real, selectable, copyable DOM text.
- [ ] `toAccessibleTable()` returns a valid semantic table of the current view.
- [ ] `prefers-reduced-motion` honoured.

### Fallback
- [ ] WebGPU unavailable → Canvas2D renders correct output at reduced capacity, with `onPerformance({ degraded: true, reason })` fired.
- [ ] Fallback is exercised in CI with WebGPU disabled.
- [ ] Above the fallback cap, data is downsampled and reported — **never silently truncated**.

---

## 33. First 10 GitHub Issues

1. **`bench`: benchmark harness + deterministic dataset generators** — seeded generators (1k→10M, three shapes); runners for browser (Playwright) and headless (`vgpu/node`); reporter emitting p50/p95/p99/worst + variance; committed methodology doc. *Blocks everything. AC: `pnpm bench` produces a comparable report in CI and locally.*
2. **`spike`: one device, many canvases, one submit** — 6 canvases from one `init()`, all passes in one `frame()`; measure against 6 independent devices. *AC: a decision record with numbers; resolves open question #1.*
3. **`spike`: time precision on the GPU** — validate viewport-rebased `f32` relative time at 1ns resolution over a 24h domain; compare against hi/lo `f32` split. *AC: a precision-error table and a chosen representation; resolves open question #3.*
4. **`core`: `GpuRuntime` + `Capabilities` + device-loss recovery** — `init()`/`initFromDevice()`, conditional feature requests (never speculative), `tier` state machine, loss→recover→replay. *AC: unit tests in `vgpu/mock` incl. a simulated loss.*
5. **`core`: `FrameScheduler` + `RenderPlan`** — dirty tracking, compute-before-render ordering, one `frame()` per tick, `timer` span per pass, `VGPU-FRAME-REENTRANT` guards around resize. *AC: N components → one submit; clean components contribute nothing.*
6. **`core`: `ResourceRegistry`, `TargetPool`, `InstanceBuffer` + the leak test** — ref-counted shared resources, pooled targets, growable mirrored instance buffer. *AC: 100 mount/unmount cycles leak zero objects; the test is wired into CI on day one.*
7. **`react`: `GPUProvider`, `useGpu`, `useGpuCanvas`, `useGpuComponent`** — StrictMode-safe, no GPU work during render, ref-counted provider, error-boundary integration. *AC: StrictMode and Fast Refresh leak nothing; a pan gesture triggers zero React re-renders.*
8. **`wgsl`: shared module package + typegen + CI validation** — `viewport/quad/color/pack/select/lod` modules (structs + fns only), `reflectSource()`-driven TS typegen, `npx vgpu check --require-validation` in CI, committed reflection snapshots. *AC: a module that declares a binding fails the build with `VGPU-RESOLVE-MODULE-BINDING`.*
9. **`timeline`: worker ingest + view model + spatial index** — parse→columnar typed arrays, sort by (track, start), per-track index, string interning, Transferable handoff; hit-test validated against a brute-force oracle. *AC: 1M spans ingested in ≤150ms off the main thread.*
10. **`timeline`: instanced span rendering + LOD binning + indirect draw** — `spans.wgsl`, `bin.wgsl`, the two-pass plan, minimum-width clamping, indirect args written by the binning kernel and clamped in-kernel. *AC: 1M spans at p95 ≤ 8ms; visual snapshot baselines committed.*

*(Issue 11, queued: the DOM label + a11y overlay — split out because it is large enough to deserve its own review.)*

---

## 34. Recommended Implementation Order

```text
 1. bench harness + baselines            ─┐ phase 0 — measure before building
 2. spike: one device / many canvases     │
 3. spike: GPU time precision            ─┘
 4. core: runtime + capabilities + loss  ─┐
 5. core: scheduler + render plan         │ phase 1 — the runtime
 6. core: resources + LEAK TEST           │   (leak test lands with the resources,
 7. react: provider + hooks               │    not after — it is a design constraint)
 8. wgsl: modules + typegen + CI check   ─┘
 9. timeline: worker ingest + view model ─┐
10. timeline: instanced render + LOD      │ phase 2 — the component
11. timeline: DOM labels + a11y overlay   │
12. timeline: overlay pass                │
13. cli: add + doctor + registry         ─┘
14. core+timeline: interaction, picking, selection   phase 3
15. profiler + inspector + adaptive quality          phase 4
16. benchmarks published + targets confirmed/revised phase 4
17. GPUHeatmap  ← THE ARCHITECTURE TEST              phase 5
18. GPUDataGrid (glyph atlas, TanStack renderer)     phase 5
```

**The two ordering decisions that matter most:**

- **The leak test ships with the resource layer (step 6), not with the test suite later.** In every GPU-in-React library, resource leaks are the defect class that erodes trust, and they are cheap to prevent and expensive to retrofit.
- **`GPUHeatmap` (step 17) comes before `GPUDataGrid` (step 18)** even though the grid is the flagship — because the heatmap is the cheap falsification test for the runtime abstraction. If `core` needs changes to host a heatmap, we learn it in a week instead of in a month of grid work.

---

# THE CRITICAL DECISION

> *If you were the senior engineer responsible for making this project successful, what exactly would you build first, and why?*

```text
FIRST COMPONENT:
  GPUTimeline — a trace / span / event timeline (flame graphs, Gantt, waterfalls
  are the same primitive) — delivered together with @gpu-components/core, the
  shared GPU runtime. Neither ships alone: the runtime without a component is
  unproven, the component without the runtime is just another chart library.

WHY:
  It is the only candidate where the GPU requirement is unarguable AND the text
  requirement is bounded. Zoomed out on a 5M-span trace you must draw millions of
  rectangles in 16ms — DOM caps out near 5k, Canvas2D near 50k, and that is a 100x
  gap anyone can see in a side-by-side toggle. Meanwhile the number of *labelled*
  spans is bounded by screen width (~200-400), so v1 needs no GPU text engine at
  all — and the DOM label layer we build instead IS the accessibility layer.
  It also builds every primitive the DataGrid will need later, so it is the
  shortest path to the flagship rather than a detour from it.

  I am explicitly rejecting the stated hypothesis of DataGrid-first. The grid is
  the right flagship and the wrong opener: it is the one component whose GPU
  advantage is weakest (its cost is glyph raster, bounded by the viewport — which
  is exactly why glide-data-grid already scrolls millions of rows on Canvas2D)
  while its implementation cost is highest (100% text, plus editing, selection,
  copy/paste, column semantics). Leading with our weakest performance claim
  against a strong incumbent, while paying the highest implementation price, is
  the wrong opening move.

GPU ADVANTAGE:
  · Rendering: one instanced draw for millions of spans vs one CPU call per span.
  · Interaction: pan/zoom is a 64-byte uniform write — the data is never re-walked.
  · Compute in the data path: LOD density binning, min/max reduction, and
    selection masks over millions of elements per frame — the part no existing
    WebGPU component library does, and the part WebGL2 does worst.
  · Indirect draws: GPU-computed visible counts never round-trip to the CPU.
  · Crossover is honest and published: below ~30k spans, use Canvas2D.

TARGET USERS:
  Developer-tools and observability engineers building trace/profile UIs; AI
  tooling teams building LLM agent trace viewers (currently all hand-rolling this
  in Canvas2D — the sharpest 2026 wedge); performance and CI dashboards; anyone
  who has embedded Perfetto because there was no component to embed instead.

MVP SCOPE:
  IN:  one Gpu per provider; one submit per tick; frame scheduler; resource
       registry + leak test; capability gate + Canvas2D fallback; device-loss
       recovery; React adapter (3 hooks); GPUTimeline with worker ingest,
       instanced spans, LOD binning, indirect draw, overlay pass, DOM label +
       a11y overlay, pan/zoom/hover/brush; shadcn-style CLI; docs + playground;
       the benchmark harness and published methodology.

WHAT NOT TO BUILD:
  No charts (ChartGPU/chartcn own that; do not fight there). No scene graph.
  No full frame graph. No general 2D vector renderer — the four-primitive rule is
  a hard boundary and a fifth primitive requires an RFC. No GPU text engine in v1.
  No Vue/Svelte adapters. No shader-manager, compute-manager, renderer, or device
  wrapper — vgpu owns all four. No vgpu/scene usage. No <GPUShader> runtime-WGSL
  component. No component marketplace. No second component until the heatmap
  proves the runtime needs zero changes.

ARCHITECTURE:
  One vgpu Gpu per <GPUProvider>; one Surface per component canvas (idiomatic
  vgpu — its own docs show multi-canvas from one device); a FrameScheduler that
  collects every mounted component's RenderPlan into ONE frame(gpu, ...) per rAF
  tick, giving one command buffer and one submit for the whole page. Components
  are imperative objects with a four-method lifecycle (create/update/plan/dispose)
  — a deliberately simplified deck.gl Layer. Rendering is a flat ordered pass list
  with declared-but-unenforced resource edges, so the frame-graph upgrade costs
  nothing today and is available later. React is an adapter with three hooks and
  no GPU state; core builds with React uninstalled, enforced in CI. Data is
  columnar typed arrays: parsed and sorted once in a worker, uploaded once,
  re-rendered from uniform changes. Accessibility and labels are the same DOM
  overlay, derived from the same view model, so a11y cannot silently rot.

BIGGEST TECHNICAL RISK:
  That WebGPU's advantage over WebGL2 turns out to be modest for instanced quad
  throughput specifically — which would gut the headline claim. Mitigated by
  measuring it in phase 0 BEFORE building, publishing the comparison even when it
  is close, and positioning on compute-in-the-data-path (binning, reduction,
  selection, indirect) rather than on fill rate. Runner-up: GPU time precision —
  WGSL has no f64, and a trace spanning nanoseconds to hours will produce subtle
  wrong-pixel bugs unless the viewport-rebasing scheme is validated first. That
  is why it is spike #3, before any renderer code.

BIGGEST PRODUCT RISK:
  That "GPU trace timeline" reads as niche next to "GPU data grid", so the project
  is under-adopted despite being better engineered. Mitigated by positioning the
  component as the whole family it actually is (spans, flame graphs, Gantt,
  waterfalls), leading with the LLM-agent-trace and profiler use cases, and
  putting GPUDataGrid on the public roadmap from day one so the flagship is
  visible before it ships.

SUCCESS METRIC:
  Primary (architectural): GPUHeatmap ships in phase 5 requiring ZERO changes to
  @gpu-components/core. That is the falsifiable test of whether we built a runtime
  or just a component with extra steps.
  Secondary (performance): 5M spans at p95 <= 16.6ms sustained pan/zoom on a
  mid-range discrete GPU, with the Canvas2D crossover measured and published.
  Tertiary (adoption): 3 external projects shipping GPUTimeline in production
  within 6 months of v1, and at least one contributed component RFC.
```

---

# First 4 Weeks, by Week

Assumes one senior engineer full-time. Each week ends in something runnable and measured.

### Week 1 — Measure the ground truth (phase 0)

**Goal: know the real numbers before committing to an architecture. No runtime code this week.**

| Day | Task |
|---|---|
| 1 | Monorepo scaffold: pnpm workspaces, TS project refs, ESLint (incl. the `no-react-in-core` rule), Vitest, `apps/bench`. Pin exact `vgpu` version. Verify the WGSL loader works in Vite **and** Next.js/Turbopack — this is a known integration risk and it should fail on day 1, not week 6. |
| 2 | Deterministic dataset generators: seeded, 1k→10M, three shapes (shallow-wide, deep-nested, bursty). Columnar output. Committed as code + seed, never as fixtures. |
| 3 | Baseline implementations of the *same* visual output: DOM (virtualised divs), Canvas2D (`fillRect` loop). Measure both at every size. Reporter emitting p50/p95/p99/worst + variance, plus the scripted-gesture replay so every mode is compared on identical input. |
| 4 | WebGL2 baseline (minimal instanced-quad regl or raw). **This is the most important number in the project** and it must exist before we build on WebGPU. |
| 5 | **Spike #2:** 6 canvases from one `init()`, all passes in one `frame()`, vs 6 independent devices. Measure swapchain and submit cost. Write the decision record. |

**Week 1 exit:** a committed benchmark report with DOM / Canvas2D / WebGL2 numbers at every size on ≥2 hardware tiers, a methodology doc, and a resolved canvas-topology decision.

### Week 2 — The runtime skeleton (phase 1a)

**Goal: one device, one submit, zero leaks.**

| Day | Task |
|---|---|
| 1 | **Spike #3: GPU time precision.** Viewport-rebased `f32` vs hi/lo split at 1ns over 24h. Produce the error table, choose the representation, write it into `packages/wgsl/viewport.wgsl`. Everything downstream depends on this being right. |
| 2 | `GpuRuntime` + `Capabilities`: `init()`/`initFromDevice()`, adapter feature probing before requesting (never speculative — unsupported names fail `init`), `tier` state machine, `gpu.onError` forwarding. Unit tests on `vgpu/mock` with `createMockAdapter({ features })` for both the with- and without-`timestamp-query` paths. |
| 3 | `FrameScheduler` + `RenderPlan` + `SurfaceHandle`: dirty tracking, compute-before-render, one `frame()` per tick, `timer` span per pass, and the `onResize`-outside-frame discipline that avoids `VGPU-FRAME-REENTRANT`. |
| 4 | `ResourceRegistry` + `TargetPool` + `InstanceBuffer` (with the CPU mirror that device-loss recovery requires). |
| 5 | **The leak test**, wired into CI: 100 mount/unmount cycles → zero live GPU objects, using `gpu.settled()` for deterministic teardown. Plus device-loss simulation and replay. |

**Week 2 exit:** two trivial components on one page produce one device and one submit; the leak test is green in CI; `packages/core` builds with React uninstalled.

### Week 3 — React adapter, shaders, and first pixels (phase 1b → 2a)

| Day | Task |
|---|---|
| 1 | `packages/wgsl` v1: `viewport`, `quad`, `color`, `pack`, `select`, `lod` — structs and functions only. `npx vgpu check --require-validation` in CI, with committed reflection snapshots. Wire the `reflectSource()` → TS typegen step. |
| 2 | `@gpu-components/react`: `GPUProvider`, `useGpu`, `useGpuCanvas`, `useGpuComponent`. All GPU work in effects, never in render. StrictMode/Fast-Refresh tests. Assert a simulated pan causes zero React re-renders. |
| 3 | `InstancedQuadLayer` + `spans.wgsl`: the no-geometry quad path (`vertices: 6`, per-instance attributes from a storage buffer), viewport transform, minimum-width clamping. **First pixels.** |
| 4 | Timeline worker ingest: parse → columnar typed arrays → sort by (track, start) → per-track index → string interning → Transferable handoff. Hit-test validated against a brute-force oracle. |
| 5 | Wire ingest → `InstanceBuffer` → draw. Render 1M static spans. Measure against the week-1 baselines and **write the comparison down**, whatever it says. |

**Week 3 exit:** 1M spans rendering from real data through the real runtime, with a first honest number against DOM / Canvas2D / WebGL2.

### Week 4 — Interaction, LOD, and the demo that sells it (phase 2b)

| Day | Task |
|---|---|
| 1 | Viewport model + pan/zoom: wheel/drag/keyboard → uniform write only. Inertia behind `prefers-reduced-motion`. Controlled and uncontrolled `domain`. |
| 2 | `bin.wgsl` LOD density compute + indirect draw args (clamped in-kernel against `maxComputeWorkgroupsPerDimension`), and the raster LOD path for zoomed-out views. Tune the crossover threshold. |
| 3 | CPU hit-testing via the per-track index → hover state → overlay pass (`overlay.wgsl`): hover outline, cursor, axis rules. Measure hover latency at 5M. |
| 4 | DOM label overlay: virtualised to visible labels, keyed pooling, `transform`-only updates. Measure the reconciliation cost at 400 nodes/frame (open question #6) and adjust the budget on the evidence. |
| 5 | Playground v0 with the **renderer toggle** (WebGPU / Canvas2D / DOM on identical data with a scripted gesture) and the live metrics readout. Publish the week-4 benchmark report; confirm or publicly revise the phase-4 targets. |

**Week 4 exit:** an interactive `GPUTimeline` at 1M+ spans with pan/zoom/hover/labels, a playground that demonstrates the GPU benefit rather than asserting it, and a measured, published performance story that the rest of the roadmap can be planned against.

**Not in the first four weeks, deliberately:** selection/brush, GPU picking, the glyph atlas, the CLI, the inspector, the a11y keyboard model (the *overlay* exists in week 4; the full keyboard/AT model is phase 3), and any second component.
