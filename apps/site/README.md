# apps/site

The public project site for **gpu-components** — the landing page, the design rationale, and the
component roadmap. It is the artefact that lets people argue with the architecture in `PLAN.md`
before any of it is built.

This is *not* `apps/docs`. Per §25 of the plan, `apps/docs` is the future component-documentation
app (Next.js, MDX, the vgpu WGSL loader, the 15-section component page template). It has nothing to
document yet. This site exists now — and, as of this migration, is itself built on Next.js too.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run build` | Static export to `out/` (`next build`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | Asserts every exported route in `out/` rendered real content |
| `npm run check` | typecheck → build → smoke. Run this before pushing |

## Stack

React 18 + **Next.js App Router** + TypeScript + **StyleX**, statically exported (`output: 'export'`
in `next.config.ts`) — the site has no data fetching and no server-only needs, so there's no reason
to run a Node server for it.

- **Routing** — Next's file-based App Router (`app/*/page.tsx`). `src/link.tsx` is a thin wrapper
  around `next/link` that keeps the `Link`/`useIsCurrent` API the components already used.
- **Styling** — StyleX (`@stylexjs/stylex` + `@stylexjs/unplugin`'s webpack build, wired in
  `next.config.ts`). Compile-time atomic CSS.
- **Code samples** — tiny span-wrapping helpers (`c`, `k`, `str`, `fn`, `num` in `src/ui.tsx`)
  rather than a highlighter, because there are six snippets on the whole site.
- **Client/server split** — page bodies are Server Components by default. Only `theme.tsx`,
  `theme-scope.tsx`, `link.tsx`, `components/Chrome.tsx`, and `components/SpanBenchmark.tsx` carry
  `'use client'` — everything else (all six pages, `ui.tsx`, `Layers.tsx`) renders server-side.

### Why Webpack, not Turbopack

StyleX has no Turbopack plugin yet, so `package.json`'s `dev`/`build` scripts pass `--webpack`
explicitly (Next 16 defaults to Turbopack and no longer falls back on its own when it sees a custom
`webpack()` config).

### StyleX layout

```text
src/tokens.stylex.ts   defineVars — colours, fonts, radii, sizes (themeable)
app/globals.css        the CSS entrypoint + the minimal element reset, imported once in app/layout.tsx
src/ui.tsx             the primitive library: Stack/Grid/Card/Section/List/Table/Code/…
```

Constraints that shaped the code, worth knowing before editing it:

1. **`.stylex.ts` files may export nothing but `defineVars`.** No helpers, no components. That is
   why tokens live in their own file rather than in `ui.tsx`.
2. **Breakpoints are inlined per file as local `const` strings, not shared via
   `stylex.defineConsts`.** There used to be a `src/breakpoints.stylex.ts` exporting a shared `bp`
   object via `defineConsts`. It was removed: `@stylexjs/babel-plugin` 0.19.0's cross-file
   constant-hoisting for `defineConsts` does not resolve back to real `@media` text when StyleX's
   rules are collected in a single app-wide batch — which this project's webpack/Next pipeline
   does (Vite processed rules differently and never hit this). The result was invalid CSS
   (`var(--hash){...}` with no matching declaration anywhere) that crashed `lightningcss` at build
   time — verified with a minimal repro directly against the babel plugin, independent of webpack
   or Next. Every file that needs a breakpoint now declares its own literal
   `const NAV = '@media (max-width: 720px)'`-style constant next to its `stylex.create()` call —
   StyleX evaluates a same-file `const` with no cross-file indirection to resolve, so the bug
   doesn't apply. If a future StyleX release fixes the cross-file case, reintroducing a shared
   `defineConsts` file is a reasonable cleanup — confirm on a **cold** `next build` (`rm -rf .next
   out` first) before trusting it, since a warm build cache can mask this class of bug.
3. **`app/globals.css` hand-pastes the base `:root` declarations for every `stylex.defineVars`
   group in `tokens.stylex.ts`.** Same upstream bug as above, different symptom: the same
   app-wide-batch collection silently drops the base `:root, .hash{...}` rule that gives every
   colour/font/radius/size token its default value, while every individual *usage* of a token
   (`var(--hash)`) still compiles fine. The effect was total — every themed value in the site,
   including basic container padding, silently resolved to nothing. `globals.css` carries a
   comment with the exact command to regenerate those four blocks if `tokens.stylex.ts` changes;
   verify the same way — a cold `next build`, then grep the emitted CSS for `:root`.
4. **No descendant selectors.** StyleX is atomic per-element, so patterns like `.ul li::before` and
   `table th` cannot exist. Lists render a real `<span>` marker (`LI` in `ui.tsx`) and tables use
   `Th`/`Td` components that style themselves. StyleX explicitly prefers real elements over
   `::before`, and here it also made the check/cross lists announce properly instead of leaking
   punctuation into the accessible name.
5. **No attribute or `:last-child` selectors.** State that CSS would normally match on comes from
   JS instead: the nav's current-page underline uses `useIsCurrent` (`src/link.tsx`, backed by
   `usePathname()`), and `Td`/`Stat`/segmented buttons take a `last` prop.
6. **Never combine `className` with a `stylex.props()` spread.** Components take an `sx` prop
   instead. The one place a raw class name is used is `SpanBenchmark`, which creates pooled `<div>`s
   imperatively — it pulls the compiled name out of `stylex.props(s.span).className` and keeps
   per-node values on `.style`, because those differ for every element.

### Why `useCSSLayers: false`

`app/globals.css` carries an unlayered element reset (`body`, `h1`–`h4`, `p`). Layered rules lose to
*any* unlayered rule regardless of specificity, so with layers on, a reset rule would beat every
StyleX class on that element. Unlayered, the atomic class `(0,1,0)` correctly outranks the element
selector `(0,0,1)`. This matches StyleX's own guidance for adding it to an app with existing CSS.

## The benchmark widget

`src/components/SpanBenchmark.tsx` is the one piece of real engineering here, and it is load-bearing
for the site's credibility: **it measures the visitor's own browser rather than printing numbers we
assert.** It's a Client Component, but all its `window`/`document`/canvas access happens inside
effects and event handlers — never during render — so it still server-renders cleanly.

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

## Theming, without a server/client flash

The dark/light toggle predates any server rendering here, so it needed care during the migration.
The flash-prevention inline script (in `app/layout.tsx`'s `<head>`) still sets `data-theme` on
`<html>` before first paint, exactly as it did in the old `index.html`. `ThemeProvider`
(`src/theme.tsx`) can't read that attribute during SSR (there's no `document` on the server), so it
renders `'dark'` as a deterministic default for both the server pass and the initial client
hydration pass, then re-syncs from the real DOM attribute in a `useLayoutEffect` — which still runs
before the browser paints, so there's no visible flash, just no hydration-mismatch warning either.

## Testing

`npm run smoke` runs after `npm run build` and asserts, against the real static files in `out/`,
that each of the seven routes rendered real content, that no nav link is dead, and — since StyleX
failing silently would produce an unstyled page that still "renders" — that elements actually carry
compiled atomic class names.

## Deployment

Because the site is statically exported with `trailingSlash: true`, every route gets a real
`route/index.html` file in `out/` — no SPA rewrite is needed on any static host (Netlify, Vercel,
GitHub Pages, an S3 bucket, `nginx` serving `out/` directly, etc.). Just serve the `out/` directory.

## Content ownership

Every claim on this site traces to `PLAN.md` at the repo root. If the two disagree, the plan wins and
the site is the bug. In particular the site must never acquire a performance number that the
benchmark harness (phase 0) has not actually produced.
