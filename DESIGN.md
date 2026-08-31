---
name: gpu-components
description: A dark-first developer surface for evaluating GPU-accelerated application components — credible, measured, infrastructure-grade.
colors:
  bg: "#08090b"
  bg-raised: "#0d0f13"
  surface: "#101318"
  surface-2: "#151920"
  border: "#1d222b"
  border-strong: "#2a313d"
  border-hover: "#384253"
  text: "#e7e9ee"
  text-dim: "#a2aab8"
  text-faint: "#6d7686"
  accent: "#8b9dff"
  accent-hover: "#9dabff"
  accent-dim: "#5f70cc"
  on-accent: "#0a0c12"
  mint: "#5be9b9"
  amber: "#f0b072"
  rose: "#f08a8a"
  code-text: "#cfd6e4"
  code-comment: "#5f6b7f"
  code-keyword: "#b7a4ff"
  code-string: "#7fd8b0"
  code-fn: "#8fb7ff"
  code-num: "#f0b072"
  code-inline: "#c8d1e2"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif"
    fontSize: "clamp(34px, 5.4vw, 58px)"
    fontWeight: 620
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif"
    fontSize: "clamp(24px, 3vw, 32px)"
    fontWeight: 620
    lineHeight: 1.15
    letterSpacing: "-0.028em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: "5px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  gutter: "24px"
  section-y: "84px"
  card: "22px"
  card-lg: "28px"
  nav-height: "58px"
  max-width: "1120px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "10px 17px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "10px 17px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "10px 17px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "10px 17px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.lg}"
    padding: "{spacing.card}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
---

# Design System: gpu-components

## Overview

**Creative North Star: "The Instrument Panel"**

This is a developer-evaluation surface for a GPU runtime library — not a consumer product landing page and not a decorative WebGPU showcase. The visual world reads like calibrated instrumentation: dark by default, system-native typography, monospace for operational labels, and color reserved for signal (accent), success (mint), and caution (amber). Expression comes from information density and honest measurement, not from gradient heroics or motion for its own sake.

The site (`apps/site`) implements this world in StyleX with compile-time atomic CSS, a primitive component library in `src/ui.tsx`, and themeable color tokens in `src/tokens.stylex.ts`. Light mode exists as a `createTheme` override but dark is the default and the primary design reference.

**Key Characteristics:**

- Dark-first tonal layering — depth via surface steps (`bg` → `surface` → `surface2`) and 1px borders, not drop shadows
- System UI fonts throughout; monospace reserved for labels, code, brand mark, and table headers
- Periwinkle accent (`#8b9dff`) used sparingly for links, primary actions, and active nav — never as ambient fill
- Clinical minimal component feel: bordered controls, quiet 140ms hovers, maximum readable content per viewport
- Credible anti-hype posture — benchmarks disabled or capped rather than fabricated; notices for constraints
- StyleX constraints shape the system: no descendant selectors, real elements over pseudo-content, breakpoints inlined per file

## Colors

The palette is cool-neutral dark with a periwinkle primary accent and mint/amber/rose semantic signals. Light mode inverts to paper-white surfaces with deeper accent saturation.

### Primary

- **Instrument Periwinkle** (`#8b9dff`): Primary actions, in-text links, active nav underline, architecture-layer highlights. Hover shifts to `#9dabff`. Text on accent uses `#0a0c12` (dark) or `#ffffff` (light).
- **Dim Periwinkle** (`#5f70cc`): Bullet markers, de-emphasized accent touches where full saturation would compete with content.

### Neutral

- **Obsidian Base** (`#08090b`): Page background (`color.bg`). Body literal in `globals.css` for pre-hydration paint.
- **Raised Obsidian** (`#0d0f13`): Code block backgrounds, mobile nav drawer, elevated strips.
- **Panel Surface** (`#101318`): Cards, table headers, code bar — the default contained surface.
- **Panel Surface 2** (`#151920`): Button hover state, inline code background.
- **Hairline Border** (`#1d222b`): Default dividers, card borders, section rules, table cells.
- **Strong Border** (`#2a313d`): Button borders, notice frames — one step louder than default.
- **Hover Border** (`#384253`): Button hover border shift.
- **Primary Text** (`#e7e9ee`): Headlines, strong emphasis, brand.
- **Secondary Text** (`#a2aab8`): Body copy, table cells, nav default.
- **Tertiary Text** (`#6d7686`): Eyebrows, captions, footer, table header labels.

### Semantic

- **Signal Mint** (`#5be9b9`): Success states, check-list markers, "done" status dots, copied-layer accent in architecture diagram.
- **Caution Amber** (`#f0b072`): Warnings, "progress" status, notice left-border variant, numeric code tokens.
- **Alert Rose** (`#f08a8a`): Cross-list markers, error-adjacent emphasis.

### Named Rules

**The One Accent Rule.** The primary accent appears on ≤10% of any viewport — CTAs, active nav, links, and deliberate highlights only. Its rarity signals action and credibility; flooding screens with periwinkle reads as marketing, not instrumentation.

**The Measured Signal Rule.** Mint, amber, and rose are semantic only (status, notices, list polarity). Never use them as decorative gradients or ambient backgrounds except at ≤6% `color-mix` tints inside notice callouts.

## Typography

**Display Font:** System UI sans (`ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif`)

**Body Font:** Same system stack — no separate body family

**Label/Mono Font:** System monospace (`ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`)

**Character:** Native, zero-latency, and intentionally unbranded — typography should feel like it shipped with the OS or the IDE, not a marketing site. Weight 620 on headings gives authority without a custom display face.

### Hierarchy

- **Display** (620, `clamp(34px, 5.4vw, 58px)`, 1.08): Hero headlines on the landing page. Page-level H1 uses a slightly smaller clamp (`30px`–`44px`).
- **Headline** (620, `clamp(24px, 3vw, 32px)`, 1.15): Section titles inside `Section` and `PageHead`.
- **Title** (620, 18px/16px sm, 1.25): Card headings, sub-section labels.
- **Lead** (400, `clamp(16px, 1.6vw, 19px)`, 1.6, max 68ch): Section intros and page leads — the primary explanatory voice.
- **Body** (400, 16px/14.5px sm, 1.65, max 74ch): Prose paragraphs; dim color by default.
- **Label** (500 mono, 12px, 0.08em tracking, uppercase): Eyebrows, table column headers, architecture ownership tags.
- **Small** (400, 14px, 1.6): Captions, footer, secondary metadata.

### Named Rules

**The Mono Boundary Rule.** Monospace is for operational text — eyebrows, chips, code, brand wordmark, table headers, architecture labels. Never set body paragraphs or headlines in mono.

**The Measure Rule.** Prose blocks cap at 68–74ch. Tables and code blocks may exceed width inside horizontal scroll containers, not by stretching line length in copy.

## Layout

Content lives in a centered `Wrap` container: max-width 1120px (`size.maxWidth`), 24px horizontal gutter (`size.gutter`).

**Vertical rhythm:** Sections use 84px block padding with a 1px top border rule (`surface.section`). Page headers use 64px top / 40px bottom with a bottom border. Internal section stacks default to 32px gap; cards and grids use 16px.

**Grid system:** `Grid` component provides 2/3/4-column responsive grids. Breakpoints are file-local in StyleX:
- `620px` (SM): single column for 2/3/4-col grids
- `900px` (MD): 2 columns for 3/4-col grids
- `720px` (NAV): mobile nav collapse in chrome
- `940px` (HERO): landing hero two-column → single column

**Sticky chrome:** Navigation is sticky at top with 58px height, frosted backdrop (`color-mix` 86% bg + `backdrop-filter: blur(12px)`), and 1px bottom border.

**Density stance:** Clinical minimal — favor readable tables, tight but not cramped chip/button sizing, and scroll containers for overflow rather than hiding content.

## Elevation & Depth

This system is **tonal and flat**. Depth is conveyed through background stepping (`bg` → `bgRaised` → `surface` → `surface2`) and border contrast (`border` → `borderStrong` → `borderHover`), not through drop shadows.

Cards, tables, and code blocks use 1px solid borders and radius — they do not float. The only atmospheric depth on the landing hero is a single radial gradient glow (`color-mix(in srgb, accent 15%, transparent)`) behind the hero — decorative, pointer-events none, and excluded from the accessibility tree.

Sticky nav uses backdrop blur as a functional legibility layer over scrolling content, not as decorative elevation.

### Named Rules

**The Flat-By-Default Rule.** Surfaces rest flat. Do not add box-shadow to cards, buttons, or sections. If something needs emphasis, step the surface color or strengthen the border — not the shadow.

**The Frosted Chrome Rule.** Backdrop blur is permitted only on sticky/fixed chrome (nav) where content scrolls beneath. Nowhere else.

## Shapes

Corners are modest and consistent: 5px (`sm`) for inline code, 8px (`md`) for buttons/layers/nav controls, 10px (`lg`) for cards/tables/code blocks, 999px (`pill`) for chips and status dots.

Borders are always 1px solid except nav active indicator (1.5px bottom) and notice left accent (3px inline-start). Architecture "copied" layers use dashed borders; "ours" layers use accent-tinted `color-mix` borders and backgrounds.

No pill-shaped primary buttons — pills are for tags and status only.

## Components

Component feel: **clinical minimal** — bordered, quiet hovers, information-forward. All primitives live in `apps/site/src/ui.tsx`; chrome in `src/components/Chrome.tsx`.

### Buttons

- **Shape:** 8px radius (`radius.md`)
- **Secondary (default):** `surface` background, `borderStrong` border, `text` color, 10×17px padding, 550 weight, 140ms background/border transition
- **Primary:** `accent` fill, `onAccent` text, 620 weight; hover → `accentHover`
- **Hover / Focus:** Background steps one surface level (`surface` → `surface2`) or accent brightens; border shifts to `borderHover`. No scale transforms or shadows.
- **Link buttons:** `LinkBtn` applies the same styles via router `Link` wrapper

### Chips & Status

- **Style:** Mono 12px, pill radius, `surface` fill, `borderStrong` 1px border, 4×10px padding
- **Status dots:** 6px circle — `textFaint` (planned), `amber` (progress), `mint` (done), `accent` (live)

### Cards / Containers

- **Corner Style:** 10px (`radius.lg`)
- **Background:** `surface` with `border` 1px
- **Shadow Strategy:** none
- **Border:** 1px solid `border`
- **Internal Padding:** 22px default, 28px when `lg`

### Notices

- **Style:** `borderStrong` frame, 3px left accent (`amber` or `accent`), 6% `color-mix` tinted background, 16×18px padding, 14.5px body

### Code Blocks

- **Style:** `bgRaised` pre area, `surface` header bar with filename, `border` frame, 10px radius
- **Inline code:** `surface2` fill, `border` 1px, 5px radius, 0.875em mono
- **Syntax:** Span-wrapped token colors (comment/keyword/string/fn/num) — no highlighter dependency

### Navigation

- **Brand:** Mono 14px 600, `-0.01em` tracking, with inline SVG mark
- **Links:** 14px, `textDim` → `text` on hover; active route gets `text` + 1.5px `accent` bottom border (desktop) or full-width bottom border (mobile)
- **Mobile:** Hamburger at ≤720px; links collapse to stacked drawer on `bgRaised`
- **Theme toggle:** 32×32 icon button, quiet surface hover

### Tables

- **Container:** Horizontal scroll wrapper with `border` frame and 10px radius
- **Headers:** Mono 11.5px uppercase, 0.06em tracking, `surface` background, `textFaint`
- **Cells:** 11×16px padding, `textDim`, bottom `border` rule; last row omits bottom border via `last` prop

### Architecture Layer Stack (signature)

- **Layers component:** Vertical stack of bordered rows showing runtime stack; "ours" rows get accent-tinted border/bg; "copied" rows get dashed mint-tinted border; ownership label in mono uppercase at right

### SpanBenchmark (signature)

- **Purpose:** Live browser FPS benchmark — credibility widget, not decoration
- **Constraints:** DOM capped at 20k nodes; WebGPU disabled until real; Canvas2D honestly optimised; pauses off-screen

## Do's and Don'ts

### Do:

- **Do** use system UI fonts exclusively — no webfont imports for the site shell
- **Do** express depth through surface steps and 1px borders (`border` → `borderStrong` → `borderHover`)
- **Do** cap prose at 68–74ch and put wide data in scroll containers
- **Do** use mono for operational labels (eyebrows, chips, code, table headers, brand)
- **Do** keep accent usage sparse — CTAs, links, active nav, deliberate highlights
- **Do** use real elements for list markers and state (StyleX has no `::before` descendants)
- **Do** pass state via props (`last`, `current`, `primary`) rather than CSS attribute selectors
- **Do** label unmeasured performance as targets; disable controls that cannot produce real numbers

### Don't:

- **Don't** add box shadows to cards, buttons, or sections — this system is flat
- **Don't** use gradient meshes, particle effects, or WebGPU shader backgrounds as decoration
- **Don't** flood the UI with accent color — rarity is the credibility signal
- **Don't** use mint/amber/rose outside semantic contexts (status, notices, polarity lists)
- **Don't** combine `className` with `stylex.props()` — use the `sx` prop pattern
- **Don't** share StyleX breakpoints via cross-file `defineConsts` (known webpack batching bug)
- **Don't** print benchmark numbers the harness has not produced
