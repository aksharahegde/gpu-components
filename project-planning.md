# Project Planning Prompt — GPU Component Runtime

Act as a **Principal Fullstack Engineer, GPU/WebGPU Architect, Rendering Engineer, and Developer-Tools Product Architect**.

I want to build a production-quality open-source project inspired by the philosophy of **shadcn/ui**, but for **GPU-accelerated application components**.

The project should use **vgpu** as the underlying GPU execution/runtime layer:

https://vgpu.sh

Do NOT assume that the goal is to build visual effects, particle systems, animated balls, shader backgrounds, or a Three.js alternative.

The goal is to build **useful application components whose rendering or computation benefits materially from GPU acceleration**.

---

# 1. Product Vision

The product should eventually allow developers to write things like:

```tsx
<GPUDataGrid
  data={orders}
  columns={columns}
/>
```

```tsx
<GPUGraph
  nodes={nodes}
  edges={edges}
/>
```

```tsx
<GPUHeatmap
  data={data}
/>
```

```tsx
<GPUTimeline
  events={events}
/>
```

without requiring the application developer to understand:

- WebGPU
- WGSL
- GPU buffers
- bind groups
- render pipelines
- compute pipelines
- texture management
- command encoders
- render passes
- GPU synchronization
- resource lifetime management

The library should hide GPU complexity behind a familiar component API.

The conceptual architecture is:

Application
→ UI Framework Adapter
→ GPU Component
→ Rendering Model
→ GPU Runtime
→ vgpu
→ WebGPU

The GPU runtime should be reusable across multiple components.

---

# 2. Core Product Principle

The most important product principle is:

> **Do not use the GPU merely because it is possible. Use it where GPU acceleration provides a measurable advantage or enables capabilities that are difficult to achieve efficiently with DOM/canvas/SVG alone.**

Every proposed component must answer:

1. What problem does it solve?
2. Why is the DOM insufficient?
3. Why is ordinary Canvas insufficient?
4. Why does WebGPU provide a meaningful advantage?
5. What workload size makes GPU acceleration worthwhile?
6. What computation belongs on the GPU?
7. What computation should remain on CPU/Web Workers?
8. What are the limitations and tradeoffs?

Reject components that are primarily decorative.

---

# 3. First Task: Investigate vgpu

Before proposing architecture, thoroughly inspect the current vgpu project and repository.

Study:

- architecture
- APIs
- runtime model
- browser support
- Node/headless support
- shader handling
- WGSL support
- compute APIs
- rendering APIs
- resource management
- testing model
- mock GPU support
- TypeScript integration
- examples
- MCP/agent-related functionality
- limitations
- extension points

Do not invent APIs.

Use the actual current vgpu APIs wherever possible.

Identify:

### What vgpu should provide

Examples:

- low-level GPU execution
- shader execution
- resource abstraction
- GPU compute
- rendering primitives

### What our project must provide on top

Examples:

- component lifecycle
- scene/runtime management
- resource sharing
- component composition
- React integration
- rendering scheduling
- GPU resource ownership
- component registry
- developer tooling
- performance instrumentation

Clearly separate these responsibilities.

---

# 4. Research Existing Ecosystem

Analyze existing projects and libraries that overlap with this idea.

Investigate at minimum:

- shadcn/ui
- Three.js
- React Three Fiber
- PixiJS
- regl
- deck.gl
- vis.gl
- Apache ECharts
- AG Grid
- TanStack Table
- MapLibre
- WebGPU libraries
- WebGL rendering libraries
- GPU data visualization libraries
- large-scale graph visualization libraries
- browser-based spreadsheet/grid implementations

For each relevant project determine:

- what it does well
- what it does poorly
- whether it uses GPU
- its rendering architecture
- component model
- extensibility model
- developer experience
- performance characteristics
- licensing
- where our project can differentiate

Do not simply create a competitor feature checklist.

Find an actual **product gap**.

---

# 5. Identify the Best Initial Product

Brainstorm at least 15 useful GPU component categories.

Consider:

### Data

- GPU DataGrid
- GPU charts
- GPU heatmaps
- scatter plots
- histograms
- large dataset visualization
- timelines
- matrix visualization

### Developer Tools

- log viewer
- trace viewer
- profiling timeline
- dependency graph
- repository graph
- network topology

### Documents

- PDF viewer
- document comparison
- image-heavy document rendering
- annotation canvas

### Images

- image viewer
- image diff
- image processing
- large-image viewer
- image annotation

### Spatial

- maps
- point layers
- route layers
- density maps
- geospatial visualization

### Editors

- diagram editor
- whiteboard
- node editor
- flow editor
- canvas-based design editor

For every category score:

- real-world usefulness
- GPU suitability
- technical feasibility
- implementation complexity
- market potential
- developer adoption potential
- differentiation
- browser compatibility
- ability to demonstrate measurable GPU advantage

Produce a weighted score.

Then recommend the **top 3 candidates**.

---

# 6. Choose the MVP

Do not automatically choose the most visually impressive component.

Choose the component that creates the strongest combination of:

- usefulness
- GPU necessity
- technical depth
- reusable architecture
- measurable performance improvement
- future extensibility

My initial hypothesis is:

1. GPUDataGrid
2. GPUCanvas / rendering runtime
3. GPUGraph

But challenge this assumption.

If research shows a better first component, recommend it.

Explain why.

---

# 7. Define the Core Architecture

Design the architecture around a shared GPU runtime.

Think in terms of:

```text
GPUProvider
    │
    ├── Device
    ├── Queue
    ├── Renderer
    ├── ResourceManager
    ├── ShaderManager
    ├── ComputeManager
    ├── FrameScheduler
    ├── Profiler
    └── CapabilityManager
             │
             ▼
       GPU Component
             │
       Rendering Model
             │
       GPU Passes
             │
            vgpu
             │
          WebGPU
```

Determine whether these abstractions are actually necessary.

Do not over-engineer.

For every proposed subsystem explain:

- responsibility
- API
- lifecycle
- ownership
- dependencies
- performance implications
- whether it belongs in v1

---

# 8. Shared Scene / Shared GPU Context

A major requirement is that multiple GPU components should coexist without creating separate WebGPU contexts.

For example:

```tsx
<GPUProvider>

  <GPUDataGrid />

  <GPUHeatmap />

  <GPUChart />

</GPUProvider>
```

or:

```tsx
<GPUScene>

  <Grid />

  <Graph />

  <Overlay />

</GPUScene>
```

Investigate how to implement:

- one GPUDevice
- shared command queue
- shared render loop
- shared resources
- shared textures
- shared buffers
- shared samplers
- pipeline caching
- shader caching
- resize handling
- device loss
- fallback behavior

Determine whether a scene graph is necessary or whether a render-pass/frame-graph architecture is better.

Compare both approaches.

---

# 9. Rendering Architecture

Design a rendering abstraction capable of supporting:

- 2D rendering
- instanced rendering
- GPU compute
- offscreen textures
- post-processing when justified
- large datasets
- overlays
- interaction
- hit testing
- selection
- zoom
- pan
- clipping
- viewport management

Investigate whether to use:

### Option A

Scene graph

### Option B

Render graph / frame graph

### Option C

Hybrid

Recommend one.

Explain why.

---

# 10. GPU vs CPU Responsibilities

This is extremely important.

Define clearly what should happen on:

### Main thread

### Web Worker

### GPU

For example:

```text
Data ingestion
     ↓
Worker
     ↓
Parsing
     ↓
Typed representation
     ↓
GPU buffer
     ↓
GPU filtering
     ↓
GPU aggregation
     ↓
GPU rendering
```

Identify which operations should remain CPU-side.

Do not blindly move everything to GPU.

---

# 11. React Architecture

React should be an adapter, not the GPU runtime itself.

Design APIs such as:

```tsx
<GPUProvider>
  <GPUCanvas>
    ...
  </GPUCanvas>
</GPUProvider>
```

Potential hooks:

```tsx
useGPU()
useGPUBuffer()
useGPUTexture()
useGPUShader()
useGPUCompute()
useGPURenderPass()
useGPUFrame()
```

But do not create APIs just because they sound useful.

Determine the minimum API required.

React reconciliation should NOT cause unnecessary GPU resource creation or destruction.

Explain:

- component lifecycle
- resource lifecycle
- memoization
- cleanup
- synchronization
- React state vs GPU state
- animation loop
- concurrent rendering considerations

---

# 12. Framework Independence

Determine whether the core should be framework-independent.

Potential architecture:

```text
@gpu-components/core
        │
        ├── @gpu-components/react
        ├── @gpu-components/vue
        ├── @gpu-components/svelte
        └── @gpu-components/vanilla
```

For MVP, React is acceptable.

However, avoid coupling the underlying GPU runtime to React.

Explain what should belong to:

```text
core
react
components
```

---

# 13. Component Model

Define what a GPU component actually is.

For example:

```ts
interface GPUComponent {
  initialize(context): void
  update(props): void
  render(frame): void
  dispose(): void
}
```

But don't assume this interface is correct.

Design a proper lifecycle.

Consider:

```text
create
initialize
prepare
update
compute
render
postRender
dispose
```

Determine the minimum lifecycle.

Also determine how components declare:

- GPU resources
- dependencies
- render passes
- compute passes
- uniforms
- inputs
- outputs
- events

---

# 14. Resource Management

Design a resource manager for:

- buffers
- textures
- samplers
- bind groups
- pipelines
- shaders

Investigate:

- reference counting
- caching
- pooling
- reuse
- lazy allocation
- disposal
- resource identity
- deduplication

Avoid premature abstraction.

---

# 15. Shader System

Shaders should be first-class.

Design:

```text
WGSL
 ↓
Shader Loader
 ↓
Reflection / metadata
 ↓
Typed uniform interface
 ↓
Pipeline
```

Investigate:

- shader modules
- shader composition
- uniform generation
- bind-group layout generation
- validation
- hot reload
- shader errors
- source maps
- TypeScript types

Potential developer API:

```tsx
<GPUShader
  src="./shader.wgsl"
  uniforms={{
    scale: 1,
    opacity: 0.5
  }}
/>
```

But determine whether this is better than generated TypeScript wrappers.

---

# 16. Component Distribution Model

I specifically want to explore a model inspired by shadcn/ui.

Instead of:

```bash
npm install giant-gpu-library
```

consider:

```bash
npx gpu-components add data-grid
```

which generates:

```text
components/
└── gpu/
    └── data-grid/
        ├── GPUDataGrid.tsx
        ├── renderer.ts
        ├── shaders/
        │   ├── grid.wgsl
        │   ├── text.wgsl
        │   └── selection.wgsl
        └── types.ts
```

Analyze:

- benefits
- drawbacks
- versioning
- dependency management
- shader updates
- security
- licensing
- tree shaking
- customization
- maintenance

Determine whether this model is appropriate.

---

# 17. Performance Architecture

Performance is part of the product.

Define benchmarks for:

### Rendering

- 1K objects
- 10K
- 100K
- 1M
- 10M where realistic

### Interaction

- hover latency
- selection latency
- zoom/pan latency
- scroll latency

### Memory

- CPU memory
- GPU memory
- upload cost

### Frame performance

- CPU frame time
- GPU frame time
- FPS
- dropped frames

Compare:

```text
DOM
Canvas 2D
WebGL
WebGPU
```

where meaningful.

Do not manufacture benchmark results.

Define benchmark methodology first.

---

# 18. Progressive Enhancement / Fallback

WebGPU isn't universally available.

Design:

```text
WebGPU available
      ↓
GPU renderer

WebGPU unavailable
      ↓
Canvas / WebGL fallback

No GPU fallback
      ↓
Reduced functionality
```

Determine whether every component needs a fallback.

For example:

```tsx
<GPUDataGrid fallback="canvas" />
```

or:

```tsx
<GPUDataGrid />
```

with automatic fallback.

---

# 19. Accessibility

GPU-rendered UI introduces accessibility challenges.

This is critical.

Investigate how to provide:

- keyboard navigation
- screen-reader semantics
- accessible labels
- focus management
- text selection
- copy/paste
- ARIA representation
- semantic overlays

The GPU canvas should **not become an inaccessible black box**.

Design a hybrid architecture where semantic DOM overlays are used when appropriate.

---

# 20. Interaction Architecture

Design reusable GPU interaction primitives:

```text
Pointer
Wheel
Keyboard
Touch
Selection
Hover
Drag
Zoom
Pan
Brush
Lasso
```

Determine whether interactions should be:

```text
CPU
GPU
Hybrid
```

Especially investigate GPU picking/hit testing for large datasets.

---

# 21. Testing Strategy

Design testing at multiple levels:

### Unit

- resource management
- component lifecycle
- transforms
- data processing

### Shader

- shader compilation
- WGSL validation
- deterministic output where possible

### GPU

- render correctness
- compute correctness

### Visual regression

- screenshots
- pixel comparison

### Performance

- benchmark suite

### Integration

- React component tests

### Browser

- Chromium
- Firefox
- Safari where WebGPU support permits

Use vgpu's testing/mock capabilities where appropriate.

---

# 22. Repository Structure

Propose a monorepo structure.

For example:

```text
gpu-components/
│
├── apps/
│   ├── docs/
│   ├── playground/
│   └── benchmarks/
│
├── packages/
│   ├── core/
│   ├── renderer/
│   ├── runtime/
│   ├── react/
│   ├── shaders/
│   └── components/
│
├── components/
│   ├── data-grid/
│   ├── graph/
│   └── heatmap/
│
├── shaders/
│
├── tests/
│
└── tooling/
```

But design the actual structure based on your architecture research.

Explain why each package exists.

---

# 23. Documentation / Developer Experience

Design documentation similar to high-quality component libraries.

Each component should have:

```text
Overview
Why GPU?
When to use
When NOT to use
Installation
Quick start
API
Examples
Performance
Architecture
Accessibility
Browser support
Limitations
Source
Shader source
Benchmarks
```

The documentation should teach developers **when GPU acceleration is appropriate**, not just how to use the API.

---

# 24. Demo / Playground

Design an interactive playground.

Developers should be able to change:

```text
dataset size
rendering mode
GPU/CPU mode
parameters
```

and immediately see:

```text
FPS
CPU time
GPU time
memory
draw calls
dispatches
```

The playground should make GPU benefits obvious.

---

# 25. Developer Tooling

Investigate building a GPU inspector.

For example:

```text
GPU Inspector

Device
 ├── Vendor
 ├── Limits
 ├── Features

Frame
 ├── CPU: 2.1ms
 ├── GPU: 4.8ms
 ├── Passes: 8
 ├── Draw calls: 12
 └── Compute dispatches: 4

Memory
 ├── Buffers: 18
 ├── Textures: 6
 └── Approx GPU memory: ...
```

Determine which metrics are actually available through WebGPU.

Do not invent unsupported GPU telemetry.

---

# 26. Security

Analyze:

- arbitrary WGSL execution
- untrusted shaders
- user-provided datasets
- memory exhaustion
- malicious input
- GPU denial-of-service risks
- browser sandbox limitations

Especially consider if the library eventually supports community components/shaders.

---

# 27. API Design Principles

The public API should be:

- TypeScript-first
- composable
- declarative where appropriate
- imperative where GPU control requires it
- predictable
- tree-shakeable
- framework-independent at the core
- easy for normal frontend developers
- extensible for GPU experts

Avoid:

- unnecessary abstractions
- giant configuration objects
- magic behavior
- hidden GPU resource leaks
- React-specific concepts in core

---

# 28. Roadmap

Produce a detailed roadmap:

## Phase 0 — Research

Repository analysis, architecture validation, benchmarks.

## Phase 1 — GPU Runtime

Minimum shared runtime.

## Phase 2 — First Component

Implement the strongest MVP component.

## Phase 3 — Interaction

Selection, zoom, hover, keyboard, etc.

## Phase 4 — Performance

Benchmarking and optimization.

## Phase 5 — Component Expansion

Add additional components that reuse the runtime.

## Phase 6 — CLI

Component installation / source generation.

## Phase 7 — Ecosystem

Registry, playground, documentation, community components.

For each phase provide:

- goals
- deliverables
- files/packages affected
- dependencies
- risks
- acceptance criteria
- benchmark criteria

---

# 29. MVP Acceptance Criteria

Define concrete criteria.

For example:

### Architecture

- one shared GPUDevice
- no unnecessary GPU contexts
- deterministic resource lifecycle
- clean disposal
- no GPU resource leaks

### Performance

Define realistic target thresholds after benchmarking.

### Developer Experience

A developer should be able to go from:

```bash
npm install ...
```

to:

```tsx
<GPUComponent />
```

in minutes.

### Accessibility

The component must remain usable without relying solely on canvas pixels.

### Fallback

Define behavior when WebGPU isn't available.

---

# 30. Deliverables

Your response must be a **project plan, not implementation code**.

Produce the following sections:

1. Executive Summary
2. Product Thesis
3. Problem Statement
4. Competitive Landscape
5. GPU Opportunity Analysis
6. Candidate Component Matrix
7. Recommended MVP
8. Why This Component
9. Architecture
10. Runtime Design
11. Shared GPU Context / Scene Design
12. Rendering / Frame Graph Design
13. Shader Architecture
14. Resource Management
15. React Integration
16. Framework Independence
17. Component API Philosophy
18. CLI / Distribution Strategy
19. Performance Strategy
20. Benchmark Plan
21. Accessibility
22. Fallback Strategy
23. Testing Strategy
24. Security
25. Repository Structure
26. Documentation Strategy
27. Playground
28. Developer Tooling
29. Roadmap
30. Risks
31. Open Technical Questions
32. MVP Acceptance Criteria
33. First 10 GitHub Issues
34. Recommended implementation order

---

# 31. Important Constraints

Follow these strictly:

- Do NOT build a Three.js clone.
- Do NOT prioritize decorative effects.
- Do NOT create random shader demos.
- Do NOT assume every workload benefits from GPU.
- Do NOT move all computation to GPU blindly.
- Do NOT couple the core runtime to React.
- Do NOT create multiple WebGPU devices unnecessarily.
- Do NOT invent vgpu APIs.
- Do NOT invent browser capabilities.
- Do NOT optimize before defining benchmarks.
- Do NOT over-engineer the MVP.
- Prefer measurable performance improvements.
- Prefer components with obvious real-world utility.
- Prefer reusable GPU infrastructure.
- Prefer an architecture that can support multiple component types later.

---

# 32. Critical Decision

At the end, give me a clear recommendation:

> **If you were the senior engineer responsible for making this project successful, what exactly would you build first, and why?**

Give me:

```text
FIRST COMPONENT:
WHY:
GPU ADVANTAGE:
TARGET USERS:
MVP SCOPE:
WHAT NOT TO BUILD:
ARCHITECTURE:
BIGGEST TECHNICAL RISK:
BIGGEST PRODUCT RISK:
SUCCESS METRIC:
```

Then give me the **first 4 weeks of implementation broken down by week**, with concrete engineering tasks.

Do not start coding yet.

The output should be detailed enough that another senior engineer could take the document and begin implementation without having to rediscover the architecture.