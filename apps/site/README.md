# apps/site

The public project site for **gpu-components** — the landing page, the design rationale, and the
component roadmap. It is the artefact that lets people argue with the architecture in `PLAN.md`
before any of it is built.

This is *not* `apps/docs`. Per §25 of the plan, `apps/docs` is the future component-documentation
app (Next.js, MDX, the vgpu WGSL loader, the 15-section component page template). It has nothing to
document yet. This site exists now.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | Mounts the real app at every route in jsdom and asserts it rendered |
| `npm run check` | typecheck → smoke → build. Run this before pushing |

## Stack

React 18 + Vite + TypeScript + **StyleX**. No UI framework, no CSS framework, no router, no syntax
highlighter — the site is six pages, and each of those dependencies would have been more code than
the thing it replaced.

- **Routing** — `src/router.tsx`, ~60 lines over the History API.
- **Styling** — StyleX (`@stylexjs/stylex` + `@stylexjs/unplugin`). Compile-time atomic CSS.
- **Code samples** — tiny span-wrapping helpers (`c`, `k`, `str`, `fn`, `num` in `src/ui.tsx`)
  rather than a highlighter, because there are six snippets on the whole site.

### StyleX layout

```text
src/tokens.stylex.ts        defineVars — colours, fonts, radii, sizes (themeable)
src/breakpoints.stylex.ts   defineConsts — media queries (compile-time, never themed)
src/global.css              the CSS entrypoint + the minimal element reset
src/ui.tsx                  the primitive library: Stack/Grid/Card/Section/List/Table/Code/…
```

Four constraints shaped the code, and they are worth knowing before editing it:

1. **`.stylex.ts` files may export nothing but `defineVars`/`defineConsts`.** No helpers, no
   components. That is why tokens and breakpoints are two files rather than living in `ui.tsx`.
2. **No descendant selectors.** StyleX is atomic per-element, so patterns like `.ul li::before` and
   `table th` cannot exist. Lists render a real `<span>` marker (`LI` in `ui.tsx`) and tables use
   `Th`/`Td` components that style themselves. StyleX explicitly prefers real elements over
   `::before`, and here it also made the check/cross lists announce properly instead of leaking
   punctuation into the accessible name.
3. **No attribute or `:last-child` selectors.** State that CSS would normally match on comes from
   JS instead: the nav's current-page underline uses the router (`useIsCurrent`), and
   `Td`/`Stat`/segmented buttons take a `last` prop.
4. **Never combine `className` with a `stylex.props()` spread.** Components take an `sx` prop
   instead. The one place a raw class name is used is `SpanBenchmark`, which creates pooled `<div>`s
   imperatively — it pulls the compiled name out of `stylex.props(s.span).className` and keeps
   per-node values on `.style`, because those differ for every element.

### Why `useCSSLayers: false`

`src/global.css` carries an unlayered element reset (`body`, `h1`–`h4`, `p`). Layered rules lose to
*any* unlayered rule regardless of specificity, so with layers on, a reset rule would beat every
StyleX class on that element. Unlayered, the atomic class `(0,1,0)` correctly outranks the element
selector `(0,0,1)`. This matches StyleX's own guidance for adding it to an app with existing CSS.

The `@stylex;` directive that the PostCSS setup requires is **not** needed by the unplugin — the
emitted CSS is byte-identical without it, which was verified rather than assumed.

## The benchmark widget

`src/components/SpanBenchmark.tsx` is the one piece of real engineering here, and it is load-bearing
for the site's credibility: **it measures the visitor's own browser rather than printing numbers we
assert.**

It renders the zoomed-out case from the plan — every span in the dataset on screen, so every span is
drawn every frame — in either DOM or Canvas2D, and reports measured FPS, p50 and p95 frame time.

Constraints it deliberately honours:

- The **Canvas2D path is the optimised one.** Spans are pre-grouped into colour buckets so it pays
  minimal `fillStyle` changes. Flattering our own comparison would make the whole site untrustworthy.
- **DOM is capped at 20,000 nodes.** Past that it stops being a benchmark and starts being a hang.
  The cap is shown in the UI, not hidden.
- **The WebGPU button is disabled.** The runtime does not exist. The site does not print numbers it
  cannot produce; the plan's targets are labelled as targets.
- The dataset is generated from a **seeded PRNG**, so every visitor benchmarks identical data.
- It **pauses when scrolled out of view** via `IntersectionObserver`, and the first ~400ms of frames
  are discarded to exclude layout and allocation.

## Testing

`npm run smoke` mounts the real app at all seven routes in jsdom and asserts each rendered real
content, that no nav link is dead, and — since StyleX failing silently would produce an unstyled
page that still "renders" — that elements actually carry compiled atomic class names.

It is built with `vite build --ssr` rather than raw esbuild specifically so the StyleX plugin runs.
StyleX has no runtime fallback: without the compiler, `stylex.create` throws.

## Deployment

Routes are real History-API paths, so a static host needs an SPA rewrite — every unknown path serves
`index.html`. Vite's dev server and `vite preview` do this by default.

- **Netlify** — `_redirects` containing `/*  /index.html  200`
- **Vercel** — `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- **Nginx** — `try_files $uri /index.html;`

If you would rather not configure that, switch `src/router.tsx` to hash routing; it is a two-line
change in `normalise()` and the `popstate` listener.

## Content ownership

Every claim on this site traces to `PLAN.md` at the repo root. If the two disagree, the plan wins and
the site is the bug. In particular the site must never acquire a performance number that the
benchmark harness (phase 0) has not actually produced.
