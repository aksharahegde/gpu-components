---
name: gpu-components
description: A near-white developer surface for evaluating GPU-accelerated application components — credible, measured, infrastructure-grade, with exactly one accent color.
colors:
  bg: "#fafafa"
  bg-raised: "#f2f2f2"
  surface: "#fafafa"
  surface-2: "#f2f2f2"
  border: "rgba(23, 23, 23, 0.08)"
  border-strong: "#d7d7d7"
  border-hover: "#b1b1b1"
  text: "#171717"
  text-dim: "#292929"
  text-faint: "#585858"
  accent: "#006e92"
  accent-hover: "#0066ac"
  accent-dim: "#868686"
  on-accent: "#ffffff"
  mint: "#636363"
  amber: "#404040"
  rose: "#e40014"
  code-text: "#262626"
  code-comment: "#767676"
  code-keyword: "#171717"
  code-string: "#525252"
  code-fn: "#006e92"
  code-num: "#636363"
  code-inline: "#262626"
typography:
  display:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(34px, 5.4vw, 58px)"
    fontWeight: 660
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(24px, 3vw, 32px)"
    fontWeight: 660
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.06em"
  mono:
    fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: "0px"
  md: "0px"
  lg: "0px"
  pill: "0px"
spacing:
  gutter: "24px"
  section-y: "84px"
  card: "22px"
  card-lg: "28px"
  nav-height: "58px"
  max-width: "1152px"
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

**Creative North Star: "The Field Notebook, Sharpened"**

This is a developer-evaluation surface for a GPU runtime library — not a consumer landing page and not a decorative WebGPU showcase. The visual world reads like a researcher's measured lab log: a near-white page, hairline rules instead of a grey wash, system-native typography, sharp unrounded corners, and a single working accent reserved for action and evidence. Every grey that isn't spent on structure is contrast taken away from the GPU canvases sitting on the page — they are the reason anyone is here, and the page gets out of their way.

Depth comes from a light structural shadow scale used sparingly (raised chrome, notices) rather than an ambient soft-UI wash — flat plus a hairline border is still the default for `Card`. Corners are square everywhere in the site chrome (`radius.sm/md/lg/pill` all compile to `0px`); the only curves left on the page are inside the GPU-rendered canvases themselves. Expression comes from information density and honest measurement, not gradient heroics or motion for its own sake.

**Key Characteristics:**

- Near-white page (`#fafafa`, not pure `#fff`) — structure via hairline borders (`border` → `borderStrong` → `borderHover`) and type weight, not a grey scrim
- System UI fonts throughout (Geist self-hosted via `next/font`); monospace reserved for labels, code, brand mark, and table headers
- One Deep Teal accent (`#006e92`) used sparingly for links, primary actions, and active nav — never as ambient fill
- Sharp corners everywhere in chrome — `radius` tokens are all `0px`; nothing in the site shell is rounded
- Quiet, precise component feel: bordered controls, ~220ms opacity/background/border-only transitions, maximum readable content per viewport
- Credible anti-hype posture — benchmarks disabled or capped rather than fabricated; notices for constraints
- **GPU showcase content stays colorful, chrome does not.** The colorful WebGPU canvases (`registry/`, `.wgsl.ts` shaders, the playground demos) are explicitly out of the grayscale discipline — they render whatever colors the component's data calls for. Every DOM element around them — nav, footer, cards, buttons, section chrome — stays inside the grayscale-plus-one-accent palette below. This split is deliberate and unusual: most design systems apply one palette everywhere; this one draws a hard line between "the evidence" (GPU-rendered, full color) and "the frame around the evidence" (chrome, restrained).
- StyleX constraints shape the system: no descendant selectors, real elements over pseudo-content, breakpoints inlined per file, gap values from a static scale (no dynamic inline styles — the CSP has no `unsafe-inline`)

## Colors

The palette is grayscale-plus-one-accent: neutrals run `#171717` (ink) through `#fafafa` (near-white ground), with a single teal accent (`#006e92`) carrying every call to action, link, and focus ring. `mint` and `amber` — names kept from an earlier ocean-blue palette — are now muted grays (`#636363`, `#404040`) rather than hues; `rose` (`#e40014`) is the one saturated color left on the whole chrome layer, reserved for negative/error state. Every color clears WCAG AA (4.5:1) against the surface it sits on at its smallest real size (11px, used by dense demo chrome), so `textFaint` is a working text color, not decoration.

### Primary

- **Deep Teal** (`#006e92`, accent): Primary actions, in-text links, active nav underline, focus rings, architecture-layer highlights. Hover shifts to `#0066ac`. Text on accent is white (`#ffffff`).
- **Accent Dim** (`#868686`, tints/status dots only — not legal as text): Status dots and bullet tints where full saturation would compete with content.

### Neutral

- **Ground** (`#fafafa`): Page background and default surface (`color.bg`, `color.surface`).
- **Raised** (`#f2f2f2`): Code block backgrounds, elevated strips, mobile nav drawer (`bgRaised`, `surface2`).
- **Hairline Border** (`rgba(23, 23, 23, 0.08)`): Default dividers, card borders, section rules, table cells — a translucent tint of ink over whatever sits behind it, not a fixed hex.
- **Strong Border** (`#d7d7d7`): Button borders, notice frames, focus fallback frames — one step louder than default.
- **Hover Border** (`#b1b1b1`): Button hover border shift.
- **Ink Text** (`#171717`): Headlines, strong emphasis, brand.
- **Secondary Text** (`#292929`): Body copy, table cells, nav default.
- **Tertiary Text** (`#585858`): Eyebrows, captions, footer, table header labels, code comments.

### Semantic

- **Mint** (`#636363`, mid gray): "Done" status dots, check-list markers — a neutral now, kept for its position in the status vocabulary rather than for hue.
- **Amber** (`#404040`, dark gray): "Progress" status, notice left-border variant, numeric code tokens — likewise a neutral, not a warm warning color anymore.
- **Rose** (`#e40014`): The one saturated color on the chrome layer. Cross-list markers, error-adjacent emphasis only.

### Named Rules

**The One Accent Rule.** The teal accent appears on ≤10% of any viewport — CTAs, active nav, links, and deliberate highlights only. Its rarity signals action and credibility; flooding screens with color reads as marketing, not instrumentation.

**The Chrome Stays Gray Rule.** `mint` and `amber` no longer carry hue — they are grays that preserve their old semantic *position* (done/progress) without adding a second and third color to the palette. `rose` is the sole exception, kept saturated because an error state that blends into the gray scale defeats its purpose.

**The GPU Showcase Exception.** The rule above governs DOM chrome only. Anything rendered onto a `<canvas>` by the WebGPU runtime — the playground demos, the homepage `Showcase`, every `registry/` component and `.wgsl.ts` shader — draws in whatever colors its data calls for, full saturation included. The palette split is the point: restrained chrome makes colorful, credible evidence easier to trust, not harder to notice.

**The No Grey Wash Rule.** The page background is near-white, not a heavier grey scrim. Every unit of grey spent on chrome is contrast the GPU canvases don't get; structure comes from hairline borders and type weight instead.

## Typography

**Display Font:** Geist Sans, self-hosted via `next/font` (`var(--font-geist-sans)`, falling back to `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`)

**Body Font:** Same stack — no separate body family

**Label/Mono Font:** Geist Mono, self-hosted (`var(--font-geist-mono)`, falling back to `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`)

**Character:** Native-feeling and intentionally unbranded — typography should read like it shipped with the OS or the IDE, not a marketing site. Unchanged from the prior palette: weight 660 on display/headline sizes, 620 on titles.

### Hierarchy

- **Display** (660, `clamp(34px, 5.4vw, 58px)`, 1.08, `text-wrap: balance`): Hero headline on the landing page. Page-level H1 uses a smaller clamp (`30px`–`44px`).
- **Headline** (660, `clamp(24px, 3vw, 32px)`, 1.15, `text-wrap: balance`): Section titles inside `Section` and `PageHead`.
- **Title** (620, 18px/16px sm, 1.25): Card headings, sub-section labels.
- **Lead** (400, `clamp(16px, 1.6vw, 19px)`, 1.6, max 68ch): Section intros and page leads — the primary explanatory voice.
- **Body** (400, 16px/14.5px sm, 1.65, max 74ch): Prose paragraphs; dim color by default.
- **Label** (500 mono, 12px, 0.06em tracking, uppercase, wrapped in literal brackets — `[ Playground ]`): Eyebrows, table column headers, architecture ownership tags.
- **Small** (400, 14px, 1.6): Captions, footer, secondary metadata.

### Named Rules

**The Mono Boundary Rule.** Monospace is for operational text — eyebrows, chips, code, brand wordmark, table headers, architecture labels. Never set body paragraphs or headlines in mono.

**The Bracketed Eyebrow Rule.** Every `Eyebrow` renders its children wrapped in literal bracket characters — `[ Playground ]`, not `Playground` — via `Eyebrow` in `src/ui.tsx`. This is a single shared component, so every section label and page-head label on the site picks it up automatically; nothing else about the eyebrow's type or color changed.

**The Measure Rule.** Prose blocks cap at 68–74ch. Tables and code blocks may exceed width inside horizontal scroll containers, not by stretching line length in copy.

## Layout

Content lives in a centered `Wrap` container: max-width 1152px (`size.maxWidth`), 24px horizontal gutter (`size.gutter`).

**Vertical rhythm:** Sections use 84px block padding with a 1px top border rule. Page headers use 64px top / 40px bottom with a bottom border. Internal section stacks default to 32px gap; cards and grids use 16px.

**Grid system:** `Grid` component provides 2/3/4-column responsive grids. Breakpoints are file-local `const`s in StyleX (not shared via `defineConsts` — see Named Rules below):
- `620px` (SM): single column for 2/3/4-col grids
- `900px` (MD): 2 columns for 3/4-col grids
- `720px` (NAV): mobile nav collapse in chrome
- `940px` (HERO): landing hero two-column → single column

**Sticky chrome:** Navigation is sticky at top with 58px height, flat `bg`-colored background, and a 1px bottom border that steps to `borderStrong` once the page scrolls underneath it (an `IntersectionObserver`-driven `headerStuck` state in `Chrome.tsx`, not a scroll handler). The landing page's sticky 3D hero scene still backs any bare text sitting over it with a translucent-blur scrim, unchanged from the prior palette.

**Density stance:** Quiet and precise — favor readable tables, tight but not cramped chip/button sizing, and scroll containers for overflow rather than hiding content.

### Named Rules

**The Static Gap Rule.** Gap values come from a fixed `stylex.create` scale (`0, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40`), never a dynamic `gap: n` inline style — the site's CSP has no `unsafe-inline`, and a dynamic style silently drops to `normal`. An unlisted gap value should fail the typecheck, not fall back to nothing.

**The Local Breakpoint Rule.** Breakpoints are declared as same-file `const`s, not shared via `stylex.defineConsts` — a verified StyleX/webpack batching bug corrupts cross-file breakpoint constants under this app's build pipeline.

## Elevation & Depth

This system uses a light **structural shadow scale**, not an ambient soft-UI wash. `Card` and other default containers stay flat with a hairline border (`border` → `borderStrong` → `borderHover`) — shadow is the exception a component reaches for when it needs to sit visibly above the page (raised chrome, notices), not a baseline every surface gets. On a near-white ground, a heavier ambient shadow reads as a smudge rather than depth, so the scale stays shallow and rare.

The landing hero and any section sitting inside the sticky 3D scroll scene use a translucent blurred panel (`color-mix` + `backdrop-filter: blur()`) rather than a shadow to separate bare text from the canvas behind it — a legibility fix, not a decorative elevation choice.

### Shadow Vocabulary

- **`shadow.sm`** (`0 1px 2px rgba(13, 15, 20, 0.04)`): The lightest lift — barely-there separation for close-to-flat elements.
- **`shadow.md`** (`0 4px 16px -4px rgba(13, 15, 20, 0.08)`): Default raised-chrome elevation.
- **`shadow.lg`** (`0 12px 32px -8px rgba(13, 15, 20, 0.10)`): Reserved for the most visibly "above the page" elements — used rarely.

### Named Rules

**The Flat-By-Default Rule.** `Card` and ordinary containers rest flat with a 1px border. Reach for a shadow only when a surface needs to read as structurally raised above the page — not as an ambient background treatment.

**The Frosted Chrome Rule.** Backdrop blur is permitted on text panels sitting over the landing page's sticky 3D scene, where content moves beneath them. Nowhere else — the sticky nav itself is a flat, opaque `bg`-colored bar, not a frosted one.

## Shapes

Corners are sharp everywhere in the site shell: `radius.sm`, `radius.md`, `radius.lg`, and `radius.pill` are all `0px` — buttons, cards, chips, code blocks, tables, notices, the nav toggle, the skip link, all square. This is a deliberate departure from the previous rounded system (formerly 5/8/10/999px); the reference aesthetic is sharp-cornered throughout, including in Satori-rendered assets like the Open Graph card's logo tile (`src/og.tsx`) and the favicon.

Borders are always 1px solid except the notice left accent (3px inline-start). List markers are real `<span>` elements rather than `::before` pseudo-content — a StyleX constraint that also keeps check/cross list items announcing correctly to assistive tech instead of leaking punctuation.

## Motion

Motion is restrained and functional: transitions are opacity/background-color/border-color/transform only, and short — 140–220ms with a plain `ease` timing function (`button.base` and nav links use 220ms and 140ms respectively for background/border/color transitions; the sticky header's shadow-on-scroll step is 160ms). Nothing on the page animates scale, blurs in, or bounces. Reduced-motion is respected structurally: the landing page's scroll-driven `HeroJourney`/`HeroStage` scene never attaches its scroll listeners in the first place under `prefers-reduced-motion`, rather than playing a shortened version of the same animation.

### Named Rules

**The Restrained Motion Rule.** Transitions exist to soften a state change (hover, focus, scroll-stuck), never to draw attention to themselves. No transform-based hover lifts, no spring easing, no motion longer than ~220ms in chrome.

## Components

Component feel: **quiet and precise** — bordered, minimal-hover, information-forward. All primitives live in `apps/site/src/ui.tsx`; chrome (nav/footer) in `apps/site/src/components/Chrome.tsx`.

### Buttons

- **Shape:** square corners (`radius.md` = `0px`)
- **Secondary (default):** `surface` background, `borderStrong` border, `text` color, 10×17px padding, 550 weight, 220ms background/border-color transition
- **Primary:** `accent` fill, `onAccent` (white) text, 620 weight; hover → `accentHover`
- **Hover / Focus:** Background steps one surface level (`surface` → `surface2`) or accent deepens; border shifts to `borderHover`. Focus-visible gets a 2px accent outline with 2px offset. No scale transforms or added shadows.

### Chips & Status

- **Style:** Mono 12px, square corners (`radius.pill` = `0px`), `surface` fill, `borderStrong` 1px border, 4×10px padding
- **Status dots:** 6px square — `textFaint` (planned), `amber` (progress, now a dark gray), `mint` (done, now a mid gray), `accent` (live, the one colored dot)

### Cards / Containers

- **Corner Style:** square (`radius.lg` = `0px`)
- **Background:** `surface` (near-white) with `border` 1px
- **Shadow Strategy:** none at rest — see Elevation & Depth
- **Border:** 1px solid `border`
- **Internal Padding:** 22px default, 28px when `lg`

### Notices

- **Style:** `borderStrong` frame, 3px left accent (`amber` or `accent`), 6% `color-mix` tinted background, 16×18px padding, 14.5px body

### Code Blocks

- **Style:** `bgRaised` pre area, `surface` header bar with filename, `border` frame, square corners
- **Inline code:** `surface2` fill, `border` 1px, square corners, 0.875em mono
- **Syntax:** Span-wrapped token colors (comment/keyword/string/fn/num) — no highlighter dependency; six snippets on the whole site doesn't justify one. Keyword and text share `#171717`/near-black; only `fn` (`#006e92`) carries the accent color, everything else in a code block is grayscale.

### Navigation

- **Brand:** Mono, tracked tight, with inline SVG mark (three bars: accent, mint-now-gray, accent-at-45%-opacity)
- **Links:** `textDim` → `text` on hover; active route gets `text` + accent underline (desktop) or full-width bottom border (mobile)
- **Mobile:** Hamburger collapse at ≤720px; links stack into a drawer on `bgRaised`
- **Sticky behavior:** Flat `bg` background at all times; border steps from `border` to `borderStrong` once scrolled, via `IntersectionObserver` rather than a scroll listener
- **Theme toggle:** none — the site is light-only by design, no runtime theme switch

### Tables

- **Container:** Horizontal scroll wrapper with `border` frame, square corners
- **Headers:** Mono 11.5px uppercase, 0.06em tracking, `surface` background, `textFaint`
- **Cells:** 11×16px padding, `textDim`, bottom `border` rule; last row omits bottom border via `last` prop

### Landing Hero / Scroll Journey (signature)

- **Purpose:** A sticky-scroll 3D WebGPU scene (`HeroJourney`/`HeroStage`) runs behind several homepage sections, with an off-canvas live profiler readout. Reduced-motion is respected by never attaching the scroll-driven listeners in the first place, not by shortening an existing animation. Later chunks of the demo bundle defer until scrolled into view.
- **Legibility rule:** Any bare text block placed over the scene (hero copy, a kicker line, a `Section`'s eyebrow/title/lead) is backed by the translucent-blur scrim described in Elevation & Depth (`scrimHeader` opt-in on `Section`) — never left as flat text with nothing behind it.

## Do's and Don'ts

### Do:

- **Do** use Geist (self-hosted) exclusively — no other webfont imports for the site shell
- **Do** keep the page background near-white; express depth through hairline borders and a rare structural shadow, not a grey wash
- **Do** keep every corner in the DOM chrome square — `radius` tokens are `0px`, don't hand-roll a rounded corner
- **Do** cap prose at 68–74ch and put wide data in scroll containers
- **Do** use mono for operational labels (eyebrows, chips, code, table headers, brand)
- **Do** keep accent usage sparse — CTAs, links, active nav, deliberate highlights
- **Do** let GPU-rendered canvases (playground demos, `registry/` components, `.wgsl.ts` shaders) use whatever colors their data calls for — the grayscale discipline governs chrome, not the evidence on the canvas
- **Do** use real elements for list markers and state (StyleX has no `::before` descendants)
- **Do** pull gap values from the static scale, never a dynamic inline `gap: n` style (CSP has no `unsafe-inline`)
- **Do** back bare text with a translucent-blur scrim wherever it sits over the sticky 3D hero scene
- **Do** label unmeasured performance as targets; disable controls that cannot produce real numbers

### Don't:

- **Don't** add shadows to `Card` or ordinary surfaces at rest — shadow is reserved for chrome that needs to read as structurally raised
- **Don't** use gradient meshes, particle effects, or decorative color washes in chrome — that's what the GPU canvases are for
- **Don't** flood the UI with accent color — rarity is the credibility signal
- **Don't** treat `mint`/`amber` as hues anymore — they're grays that keep a semantic position (done/progress), not a color
- **Don't** add a rounded corner anywhere in the DOM chrome — the radius tokens are all `0px` on purpose
- **Don't** combine `className` with `stylex.props()` — use the `sx` prop pattern
- **Don't** share StyleX breakpoints via cross-file `defineConsts` (known webpack batching bug)
- **Don't** print benchmark numbers the harness has not produced
