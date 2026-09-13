# gpu-components

Copy [gpu-components](https://gpuc.akshara.dev) source into your repo. The component becomes
yours to edit; the runtime (`@gpu-components/core` / `@gpu-components/react`) stays a versioned
npm dependency underneath it — the same split [shadcn/ui](https://ui.shadcn.com) popularized for
DOM components, applied to WebGPU ones.

## Usage

No install needed — run it with `npx`:

```bash
npx gpu-components add timeline
```

That copies the timeline component's source into your repo (default `./components/gpu`, override
with `--path`) and reports any peer dependencies you still need to install.

### Commands

```
npx gpu-components add <component> [--path <dir>] [--force]
npx gpu-components diff <component> [--path <dir>]
npx gpu-components doctor
npx gpu-components list
```

- **`add`** — copy a component's source into your repo. Refuses to overwrite an existing file
  unless `--force` is passed.
- **`diff`** — show what would change if you ran `add` again, without writing anything. Useful
  after you've customized a component and want to see how far it's drifted from the registry.
- **`doctor`** — check your project for the runtime dependency, a WebGPU types package, and other
  install-time requirements a copied component assumes are present.
- **`list`** — print every component in the registry.

## Components

Sixteen components ship through this CLI, one shared runtime — timelines, heatmaps, grids, scatter
plots, and more. (A seventeenth, GPUAnnotationCanvas, is playground-only for v1 — run
`npx gpu-components list` for the current, authoritative set.) Browse them live at
[gpuc.akshara.dev/playground](https://gpuc.akshara.dev/playground); each has its own demo, a
"when NOT to use this" section with a measured crossover point, and a Canvas2D fallback for the
under-10% of browsers without WebGPU.

## Why copy instead of import

A chart library's component is a black box behind a props API — when the interaction feel, a
shader, or an LOD threshold needs to change, you're stuck with an escape hatch or a fork. There's
no `shader` prop, no `renderer` prop, no `uniforms` prop here: you get the actual source, and
extensibility comes from owning it.

See [gpuc.akshara.dev/start](https://gpuc.akshara.dev/start) for the full getting-started guide.

## License

MIT © Akshara Hegde
