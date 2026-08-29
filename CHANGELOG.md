# Changelog

All notable changes to this project are recorded here, grouped by date.

## 2026-08-29

Initial commit — the public `gpu-components` project site (`apps/site`), plus the project's planning
docs and repo hygiene.

### Site — pages

- **Home** — the pitch: "the gap" the runtime fills, a live in-browser DOM-vs-Canvas2D benchmark,
  the one-device/one-frame/one-submit model, the vgpu division of labour, and the first component
  (`GPUTimeline`).
- **Why GPU** — the six-question gate for justifying GPU use, a live "ceiling" benchmark, and the
  data-parallel-vs-once-per-dataset breakdown of what runs where.
- **Architecture** — the layer model (device/scheduler/primitives), the shared-context design (one
  device, many canvases, one frame), the four-method component model, and the pass-list rendering
  approach (explicitly not a scene graph or frame graph).
- **Components** — eighteen candidate components, scored in a full matrix, with `GPUTimeline` and
  `GPUDataGrid` chosen first/second, and a documented list of rejected candidates.
- **Roadmap** — the phased plan (week one is measurement, not code), success criteria, and a risk
  register of the three risks that would actually hurt.
- **Start** — the intended (not-yet-published) install steps, the objects-vs-columns data model
  rationale, requirements, and a "read this before you adopt" notice.

### Site — infrastructure

- React 18 + Vite + TypeScript, styled entirely with **StyleX** (`@stylexjs/stylex` +
  `@stylexjs/unplugin`) — no CSS framework, no UI framework.
- **Light/dark theme toggle**:
  - `src/theme.stylex.ts` — a `stylex.createTheme` override supplying light values for every token
    in `tokens.stylex.ts`.
  - `src/theme.tsx` — `ThemeProvider`/`useTheme()` context, persisting the choice to `localStorage`.
  - `index.html` — inline pre-paint script that applies the stored theme before first render,
    avoiding a flash of the wrong theme.
  - `src/global.css` — syncs the `<body>` background (outside the React root) to the active theme.
  - `src/components/Chrome.tsx` — sun/moon icon toggle button in the site nav.
- A ~60-line History-API router (`src/router.tsx`) — no routing dependency for six pages.
- A primitive component library (`src/ui.tsx`): `Stack`/`Grid`/`Card`/`Section`/`List`/`Table`/`Code`/
  typography helpers, all StyleX-driven.
- **`SpanBenchmark`** widget — measures the visitor's own browser (DOM vs. optimised Canvas2D
  rendering of the plan's span dataset), reporting live FPS / p50 / p95 frame time via a seeded PRNG
  dataset, an `IntersectionObserver` pause-when-offscreen, and a disabled WebGPU button (the runtime
  doesn't exist yet, so the site never prints a number it can't produce).
- Smoke test (`npm run smoke`) — mounts the app at every route in jsdom and asserts real content,
  no dead nav links, and that StyleX actually compiled (elements carry atomic class names).

### Repo

- Root `.gitignore` (`node_modules`, `dist`, `.smoke`, env files, editor/OS cruft, logs) alongside
  the existing `apps/site/.gitignore`.
- `PLAN.md` and the original planning prompt — the source of truth every claim on the site traces
  back to.
