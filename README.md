# gpu-components

Open-source GPU-accelerated component library for React, in the spirit of shadcn/ui: copy component source + WGSL into your repo via a CLI, while a shared runtime stays a versioned npm dependency.

`<GPUTimeline>`, `<GPUHeatmap>`, `<GPUDataGrid>` and friends share **one device, one frame loop, one submit** through a framework-independent WebGPU runtime built on [vgpu](https://vgpu.sh) — so you can drop GPU-class data surfaces into a React app without knowing WebGPU, WGSL, bind groups, or pipeline lifecycle.

## Packages

| Package | Description |
| --- | --- |
| [`@gpuc/core`](packages/core) | Framework-independent GPU runtime |
| [`@gpuc/react`](packages/react) | React adapter — owns no GPU state |
| [`@gpuc/cli`](packages/cli) | Copies component source into your repo |
| `@gpuc/wgsl` | Shared WGSL modules (structs/functions only) |
| `@gpuc/testing` | vgpu/mock + vgpu/node test harness (dev-only) |

Components themselves live in [`registry/`](registry) and are installed with the CLI, not npm.

## Install

```sh
npx @gpuc/cli add timeline
```

## Repo layout

- `packages/` — runtime, React adapter, CLI, shared WGSL, test harness
- `registry/` — component source distributed via the CLI
- `apps/site` — public project site
- `apps/bench` — benchmark harness backing documented performance numbers
- `apps/install-e2e` — end-to-end install verification

See [`PLAN.md`](PLAN.md) and [`PRODUCT.md`](PRODUCT.md) for architecture and product rationale.

## License

MIT © Akshara Hegde
