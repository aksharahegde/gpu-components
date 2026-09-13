# @gpuc/react

React adapter for [gpu-components](https://gpuc.akshara.dev). Owns no GPU state — it wires
[`@gpuc/core`](https://www.npmjs.com/package/@gpuc/core)'s runtime into
React's render/effect lifecycle and gets out of the way. Render state (selected ids, labels, the
accessibility tree) lives in React; buffers, pipelines, and per-frame uniforms live in refs and the
GPU, never in `useState`.

## Install

```bash
npm i @gpuc/core @gpuc/react
```

`react` and `react-dom` ^18.3 are peer dependencies.

## What's in here

- `<GPUProvider>` — mounts one shared `GpuRuntime` for the whole subtree (see `@gpuc/core`
  for why this is one provider, not one per component) and exposes its status via `useGpu()`.
- `useGpu()` — the provider's `{ status, runtime, capabilities }`. `status` starts `'pending'`,
  resolves to `'ready'` (real WebGPU), `'fallback'` (Canvas2D), or `'unsupported'`.
- `useCanvasRef()` / `useGpuCanvas()` — canvas ref plumbing and per-canvas surface setup against the
  shared runtime.
- `useGpuComponent()` — mounts a `GpuComponent` (from `@gpuc/core` or a registry
  component) onto the shared frame scheduler for the lifetime of the calling component.
- `<GpuInspector>` — an opt-in dev overlay for frame stats.
- `<LabelOverlay>` / `useGpuA11y()` — the semantic DOM overlay pattern registry components use to
  keep labels and interaction targets accessible over a canvas that has none natively.

## Usage

```tsx
import { GPUProvider } from '@gpuc/react'
import { GPUTimeline } from '@/components/gpu/timeline' // installed via `npx @gpuc/cli add timeline`

export default function Page() {
  return (
    <GPUProvider>
      <GPUTimeline spans={spans} tracks={tracks} />
      <GPUHeatmap data={matrix} />
    </GPUProvider>
  )
}
```

One `<GPUProvider>`, one command buffer per tick, no matter how many components are mounted inside
it. Components themselves aren't in this package — they're copied into your repo with
`npx @gpuc/cli add <name>` from the [playground](https://gpuc.akshara.dev/playground) so
you own and can edit the rendering code; this package is the part that stays a dependency.

## License

MIT © Akshara Hegde
