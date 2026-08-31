# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary:** open-source library adopters — application developers evaluating whether gpu-components fits their stack and integrating GPU-accelerated data surfaces into React apps.

They are typically senior or mid-level frontend engineers building observability tools, profilers, dashboards, trace viewers, or other apps where DOM or Canvas2D breaks down at scale. They know React; they should not need to know WebGPU, WGSL, bind groups, or pipeline lifecycle to ship a component.

**Secondary (not the primary design audience):** contributors and maintainers extending the runtime, registry, and component catalog.

## Product Purpose

gpu-components (working name: **gpu-components**, repo: **gpu-component-runtime**) is an open-source component library inspired by the shadcn/ui distribution model, but for **useful application components whose rendering or computation benefits materially from GPU acceleration**.

The product makes it possible to drop GPU-class data surfaces into a React app with a familiar component API — for example `<GPUTimeline>`, `<GPUHeatmap>`, `<GPUDataGrid>` — while hiding WebGPU complexity behind a shared runtime built on [vgpu](https://vgpu.sh).

Success means adopters can host multiple GPU components on one page with **one device, one frame loop, one submit**, measured performance at declared crossover points, honest fallbacks when GPU is the wrong tool, and accessibility that is architectural rather than bolted on.

## Positioning

The meaningful differentiator is not "charts, but faster." ChartGPU and similar libraries prove the market for WebGPU charts; nobody is building a **shared, framework-independent WebGPU runtime for heterogeneous application components** with compute in the data path, an architectural accessibility model, and a first component in a category GPU libraries do not serve (dense interactive timelines / trace surfaces).

Neighboring products cannot truthfully claim: one shared `GpuRuntime` across timeline, heatmap, grid, scatter, and graph on the same page; shadcn-style registry that copies component source + WGSL into the user's repo while the runtime stays a versioned npm dependency; and documented numeric crossover points measured on the project's own benchmark harness.

## Operating Context

- **Evaluation surface:** `apps/site` — the public project site (landing, architecture rationale, component catalog, playground demos, live SpanBenchmark). Primary Impeccable design target.
- **Adoption path:** developers discover the project via the site, read architecture and "when not to use GPU" guidance, try playground demos, then install via the registry CLI into their own repo.
- **Development workflow:** monorepo with `packages/core`, `packages/react`, `packages/cli`, `packages/wgsl`, `packages/testing`; component source in `registry/`; benchmark harness in `apps/bench`.
- **Authoritative planning doc:** `PLAN.md` at repo root. If the site and plan disagree, the plan wins and the site is the bug.
- **Performance claims:** the site must never print a performance number the benchmark harness has not actually produced. Targets are labelled as targets until measured.

## Capabilities and Constraints

**Shipped or in progress:**

- `@gpu-components/core` — framework-independent GPU runtime over vgpu (device, frame scheduler, resource registry, capability gate, profiler).
- `@gpu-components/react` — thin adapter (`<GPUProvider>`, hooks). React never owns GPU state.
- Registry components: Timeline (MVP wedge), Heatmap, Grid, Scatter, Graph, LogViewer, ImageDiff, Candlestick — with playground routes under `apps/site/app/playground/`.
- shadcn-style registry CLI pattern: component source + WGSL copied into consumer repos; runtime as npm dependency.
- Benchmark harness (`apps/bench`) with DOM, Canvas2D, WebGL2, and WebGPU renderers; `SpanBenchmark` on the site measures the visitor's browser.

**Hard constraints:**

- Do not use GPU merely because it is possible. Every component must justify GPU with a measurable advantage over DOM/Canvas2D/SVG and document when not to use it.
- WebGPU has no text rendering; vgpu provides none. Text-heavy components require an explicit staged text strategy.
- Reject primarily decorative components (particle backgrounds, shader art, Three.js alternatives).
- Accessibility is not a v2 concern: semantic overlay must share the same model the renderer draws from.
- Use actual vgpu APIs; do not invent runtime APIs.
- Site benchmark: DOM capped at 20,000 nodes; WebGPU button disabled until runtime exists; Canvas2D path must stay honestly optimized.

**Open / evolving:**

- Full benchmark matrix per PLAN.md §20 (multi-browser, multi-hardware, interaction latency, memory accounting) — partially backfilled in `apps/bench`.
- Future `apps/docs` for component documentation (MDX, 15-section template) — not built yet; site is not docs.

## Brand Commitments

- **Name:** gpu-components (package scope `@gpu-components/*`).
- **Voice:** credible, measured, anti-hype. Teach when GPU is the wrong tool. Never flatter comparisons in benchmarks.
- **Distribution model:** shadcn/ui-inspired — developers own component source; runtime stays versioned npm package.
- **Runtime dependency:** built on vgpu (`vercel-labs/vgpu`), not a from-scratch WebGPU wrapper.
- **Content ownership:** claims trace to `PLAN.md`; no fabricated customers, testimonials, benchmarks, or licensing claims.

## Evidence on Hand

| Asset | Path | Notes |
|---|---|---|
| Architecture & product plan | `PLAN.md` | Authoritative; ~2.4k lines |
| Planning prompt / vision | `project-planning.md` | Product vision and research brief |
| Public site | `apps/site/` | Next.js App Router, StyleX, static export |
| Live browser benchmark | `apps/site/src/components/SpanBenchmark.tsx` | DOM vs Canvas2D; WebGPU disabled until ready |
| Benchmark harness | `apps/bench/` | Playwright + headless trend scripts |
| Component registry | `registry/*` | Source for shadcn-style install |
| Playground demos | `apps/site/app/playground/*` | Per-component live demos |
| Baseline results | `apps/bench/results/` | After benchmark runs |

**Must not fabricate:** customer logos, testimonials, production deployment stories, performance numbers not from the harness, or licensing terms beyond what is in the repo.

## Product Principles

1. **The unit of value is the runtime, not a single component.** One chart is a weekend project; six GPU surfaces on one page without six devices is the engineering problem this project solves.
2. **GPU is a means — document when it isn't.** Every component ships crossover guidance measured on the project's own harness. Teach developers to use a `<table>` at 500 rows.
3. **Accessibility is architectural.** Semantic model and renderer draw from the same view-model; canvas opacity to assistive tech is not retrofittable.
4. **Honest benchmarks only.** Optimised comparison paths (Canvas2D colour bucketing), declared caps (DOM 20k), and disabled features (WebGPU until real) preserve credibility.
5. **Composition over decoration.** Application components for data-dense workloads — timelines, grids, heatmaps, traces — not visual effects.

## Accessibility & Inclusion

GPU surfaces are opaque pixel buffers to assistive technology by default. The product requires keyboard navigation, screen-reader semantics, and focus management built alongside rendering — not deferred. Timeline MVP success criteria include keyboard-and-screen-reader-navigable interaction. Known standard: WCAG-aligned patterns where product-specific requirements are established per component; no claim of full certification until audited.
