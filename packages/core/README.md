# @gpuc/core

Framework-independent GPU runtime for [gpu-components](https://gpuc.akshara.dev), built on
[vgpu](https://vgpu.sh). One `GpuRuntime` per page — one `GPUDevice`, one frame scheduler, one
`submit()` — shared by every mounted component instead of each component opening its own device.

This package has no React dependency. If you're using React, install
[`@gpuc/react`](https://www.npmjs.com/package/@gpuc/react) instead, which
wraps this runtime in a `<GPUProvider>` and hooks.

## What's in here

- `GpuRuntime` — device lifecycle, capability probing, the shared frame scheduler, and the
  fallback ladder (WebGPU → Canvas2D) components read `Capabilities` against.
- `GpuComponent` / `ComponentContext` / `RenderPlan` — the contract a component implements to
  mount onto the shared runtime: declare its render/compute passes, and the scheduler batches them
  into one command buffer per tick.
- Resource helpers used across the registry components: `RingBuffer`, `ResourceRegistry`,
  `createImageTexture`, `trackedUniforms`, viewport-to-pixel math (`viewportUniforms`,
  `pixelXToTime`, etc.), and `assertBufferBudget`/`GpuBudgetExceededError` for bounding
  attacker- or data-controlled allocation sizes.
- `Canvas2DScheduler` / `Canvas2DSurface` — the fallback render path for the under-10% of browsers
  without WebGPU.
- `createProfiler` — opt-in frame-timing stats, `DISABLED_PROFILER` by default.

## Install

```bash
npm i @gpuc/core
```

## Why a shared runtime

Six WebGPU components on one page usually means six `GPUDevice`s, six frame loops, and six
independent `submit()` calls competing for the GPU — the same failure mode as six separate chart
libraries each drawing their own `<canvas>`. `GpuRuntime` exists so a page can mount a timeline, a
heatmap, a grid, and a scatter plot through **one** device, **one** frame, **one** submit.

Components in the [registry](https://gpuc.akshara.dev/playground) are copied into your repo
(via `npx @gpuc/cli add <name>`) so you own and can edit the rendering code; this runtime is
the part that stays a versioned dependency underneath them.

See [gpuc.akshara.dev/architecture](https://gpuc.akshara.dev/architecture) for the full runtime
design, and [why-gpu](https://gpuc.akshara.dev/why-gpu) for when a WebGPU component is — and
isn't — the right call.

## License

MIT © Akshara Hegde
