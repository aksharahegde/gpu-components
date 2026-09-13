---
name: gpu-components
description: A white-page developer surface for evaluating GPU-accelerated application components — credible, measured, infrastructure-grade.
colors:
  bg: "#ffffff"
  bg-raised: "#f7fbfd"
  surface: "#ffffff"
  surface-2: "#e8f4f9"
  border: "#d6e9f2"
  border-strong: "#b9d8e7"
  border-hover: "#8fc0d8"
  text: "#03045e"
  text-dim: "#37476b"
  text-faint: "#4f6078"
  accent: "#0077b6"
  accent-hover: "#023e8a"
  accent-dim: "#90e0ef"
  on-accent: "#ffffff"
  mint: "#0e7c58"
  amber: "#92590a"
  rose: "#c02b2b"
  code-text: "#1f2430"
  code-comment: "#4f6078"
  code-keyword: "#6d28d9"
  code-string: "#0f7a51"
  code-fn: "#0077b6"
  code-num: "#92590a"
  code-inline: "#2b3140"
typography:
  display:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(34px, 5.4vw, 58px)"
    fontWeight: 660
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(24px, 3vw, 32px)"
    fontWeight: 660
    lineHeight: 1.15
    letterSpacing: "-0.028em"
  title:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-0.015em"
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
    letterSpacing: "0.08em"
  mono:
    fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
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

**Creative North Star: "The Field Notebook"**

This is a developer-evaluation surface for a GPU runtime library — not a consumer landing page and not a decorative WebGPU showcase. The visual world reads like a researcher's measured lab log: a pure-white page, hairline rules instead of a grey wash, system-native typography, and a single working accent reserved for action and evidence. Every grey that isn't spent on structure is contrast taken away from the GPU canvases sitting on the page — they are the reason anyone is here, and the page gets out of their way.

Depth comes from a light structural shadow scale used sparingly (raised chrome, notices) rather than an ambient soft-UI wash — flat plus a hairline border is still the default for `Card`. Expression comes from information density and honest measurement, not gradient heroics or motion for its own sake.

**Key Characteristics:**

- Pure-white page — structure via hairline borders (`border` → `borderStrong` → `borderHover`) and type weight, not a grey scrim
- System UI fonts throughout (Geist self-hosted via `next/font`); monospace reserved for labels, code, brand mark, and table headers
- Deep Ocean Blue accent (`#0077b6`) used sparingly for links, primary actions, and active nav — never as ambient fill
- Quiet, precise component feel: bordered controls, 140ms hovers, maximum readable content per viewport
- Credible anti-hype posture — benchmarks disabled or capped rather than fabricated; notices for constraints
- StyleX constraints shape the system: no descendant selectors, real elements over pseudo-content, breakpoints inlined per file, gap values from a static scale (no dynamic inline styles — the CSP has no `unsafe-inline`)

## Colors

The palette is a cool ocean-blue ramp (`03045e → 023e8a → 0077b6 → … → caf0f8`) on a pure-white ground, with mint/amber/rose semantic signals. No periwinkle or indigo anywhere. Every color clears WCAG AA (4.5:1) against the surface it sits on at its smallest real size (11px, used by dense demo chrome), so `textFaint` is a working text color, not decoration.

### Primary

- **Deep Ocean Blue** (`#0077b6`, 4.9:1 on white): Primary actions, in-text links, active nav underline, architecture-layer highlights. Hover shifts to `#023e8a` (deep navy). Text on accent is white (`#ffffff`).
- **Accent Dim / Sky Tint** (`#90e0ef`, 1.4:1 — never legal as text): Status dots and bullet tints only, where full saturation would compete with content.

### Neutral

- **Pure White** (`#ffffff`): Page background and default surface (`color.bg`, `color.surface`).
- **Cool Mist** (`#f7fbfd`): Code block backgrounds, elevated strips (`bgRaised`).
- **Pale Cyan Wash** (`#e8f4f9`): Button hover state, inline code background (`surface2`).
- **Hairline Border** (`#d6e9f2`): Default dividers, card borders, section rules, table cells.
- **Strong Border** (`#b9d8e7`): Button borders, notice frames — one step louder than default.
- **Hover Border** (`#8fc0d8`): Button hover border shift.
- **Ink Text** (`#03045e`): Headlines, strong emphasis, brand — the navy end of the ramp, not black.
- **Secondary Text** (`#37476b`): Body copy, table cells, nav default.
- **Tertiary Text** (`#4f6078`): Eyebrows, captions, footer, table header labels, code comments.

### Semantic

- **Signal Mint** (`#0e7c58`): Success states, check-list markers, "done" status dots.
- **Caution Amber** (`#92590a`): Warnings, "progress" status, notice left-border variant, numeric code tokens.
- **Alert Rose** (`#c02b2b`): Cross-list markers, error-adjacent emphasis.

### Named Rules

**The One Accent Rule.** The primary accent appears on ≤10% of any viewport — CTAs, active nav, links, and deliberate highlights only. Its rarity signals action and credibility; flooding screens with blue reads as marketing, not instrumentation.

**The Measured Signal Rule.** Mint, amber, and rose are semantic only (status, notices, list polarity). Never use them as decorative gradients or ambient backgrounds except at ≤6% `color-mix` tints inside notice callouts.

**The No Grey Wash Rule.** The page background is pure white, not a grey scrim. Every unit of grey spent on chrome is contrast the GPU canvases don't get; structure comes from hairline borders and type weight instead.

## Typography

**Display Font:** Geist Sans, self-hosted via `next/font` (`var(--font-geist-sans)`, falling back to `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`)

**Body Font:** Same stack — no separate body family

**Label/Mono Font:** Geist Mono, self-hosted (`var(--font-geist-mono)`, falling back to `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`)

**Character:** Native-feeling and intentionally unbranded — typography should read like it shipped with the OS or the IDE, not a marketing site. Weight 660 on headings (up from 620 on the retired dark palette — dark-on-light renders optically thinner than light-on-dark at the same weight) gives authority without a custom display face.

### Hierarchy

- **Display** (660, `clamp(34px, 5.4vw, 58px)`, 1.08, `text-wrap: balance`): Hero headlines on the landing page. Page-level H1 uses a smaller clamp (`30px`–`44px`).
- **Headline** (660, `clamp(24px, 3vw, 32px)`, 1.15, `text-wrap: balance`): Section titles inside `Section` and `PageHead`.
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

**Grid system:** `Grid` component provides 2/3/4-column responsive grids. Breakpoints are file-local `const`s in StyleX (not shared via `defineConsts` — see Named Rules below):
- `620px` (SM): single column for 2/3/4-col grids
- `900px` (MD): 2 columns for 3/4-col grids
- `720px` (NAV): mobile nav collapse in chrome
- `940px` (HERO): landing hero two-column → single column

**Sticky chrome:** Navigation is sticky at top with 58px height, frosted backdrop (`color-mix` translucent surface + `backdrop-filter: blur(12px–16px)`), and 1px bottom border. The same translucent-blur treatment backs any bare text block that sits over the landing page's sticky 3D hero scene (`scrimHeader` on `Section`), so copy stays legible against the moving canvas behind it.

**Density stance:** Quiet and precise — favor readable tables, tight but not cramped chip/button sizing, and scroll containers for overflow rather than hiding content.

### Named Rules

**The Static Gap Rule.** Gap values come from a fixed `stylex.create` scale (`0, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40`), never a dynamic `gap: n` inline style — the site's CSP has no `unsafe-inline`, and a dynamic style silently drops to `normal`. An unlisted gap value should fail the typecheck, not fall back to nothing.

**The Local Breakpoint Rule.** Breakpoints are declared as same-file `const`s, not shared via `stylex.defineConsts` — a verified StyleX/webpack batching bug corrupts cross-file breakpoint constants under this app's build pipeline.

## Elevation & Depth

This system uses a light **structural shadow scale**, not an ambient soft-UI wash. `Card` and other default containers stay flat with a hairline border (`border` → `borderStrong` → `borderHover`) — shadow is the exception a component reaches for when it needs to sit visibly above the page (raised chrome, notices), not a baseline every surface gets. On a white ground, a heavier ambient shadow reads as a smudge rather than depth, so the scale stays shallow and rare.

The landing hero and any section sitting inside the sticky 3D scroll scene use a translucent blurred panel (`color-mix` + `backdrop-filter: blur()`) rather than a shadow to separate bare text from the canvas behind it — a legibility fix, not a decorative elevation choice.

### Shadow Vocabulary

- **`shadow.sm`** (`0 1px 2px rgba(13, 15, 20, 0.04)`): The lightest lift — barely-there separation for close-to-flat elements.
- **`shadow.md`** (`0 4px 16px -4px rgba(13, 15, 20, 0.08)`): Default raised-chrome elevation.
- **`shadow.lg`** (`0 12px 32px -8px rgba(13, 15, 20, 0.10)`): Reserved for the most visibly "above the page" elements — used rarely.

### Named Rules

**The Flat-By-Default Rule.** `Card` and ordinary containers rest flat with a 1px border. Reach for a shadow only when a surface needs to read as structurally raised above the page — not as an ambient background treatment.

**The Frosted Chrome Rule.** Backdrop blur is permitted on sticky/fixed chrome (nav) and on text panels sitting over the landing page's sticky 3D scene, where content moves beneath them. Nowhere else.

## Shapes

Corners are modest and consistent: 5px (`sm`) for inline code, 8px (`md`) for buttons/layers/nav controls, 10px (`lg`) for cards/tables/code blocks, 999px (`pill`) for chips and status dots.

Borders are always 1px solid except the notice left accent (3px inline-start). List markers are real `<span>` elements rather than `::before` pseudo-content — a StyleX constraint that also keeps check/cross list items announcing correctly to assistive tech instead of leaking punctuation.

No pill-shaped primary buttons — pills are for tags and status only.

## Components

Component feel: **quiet and precise** — bordered, minimal-hover, information-forward. All primitives live in `apps/site/src/ui.tsx`; chrome in `src/components/Chrome.tsx`.

### Buttons

- **Shape:** 8px radius (`radius.md`)
- **Secondary (default):** `surface` background, `borderStrong` border, `text` color, 10×17px padding, 550 weight, 140ms background/border transition
- **Primary:** `accent` fill, `onAccent` (white) text, 620 weight; hover → `accentHover` (deep navy)
- **Hover / Focus:** Background steps one surface level (`surface` → `surface2`) or accent deepens; border shifts to `borderHover`. Focus-visible gets a 2px accent outline with 2px offset. No scale transforms or added shadows.

### Chips & Status

- **Style:** Mono 12px, pill radius, `surface` fill, `borderStrong` 1px border, 4×10px padding
- **Status dots:** 6px circle — `textFaint` (planned), `amber` (progress), `mint` (done), `accent` (live)

### Cards / Containers

- **Corner Style:** 10px (`radius.lg`)
- **Background:** `surface` (white) with `border` 1px
- **Shadow Strategy:** none at rest — see Elevation & Depth
- **Border:** 1px solid `border`
- **Internal Padding:** 22px default, 28px when `lg`

### Notices

- **Style:** `borderStrong` frame, 3px left accent (`amber` or `accent`), 6% `color-mix` tinted background, 16×18px padding, 14.5px body

### Code Blocks

- **Style:** `bgRaised` pre area, `surface` header bar with filename, `border` frame, 10px radius
- **Inline code:** `surface2` fill, `border` 1px, 5px radius, 0.875em mono
- **Syntax:** Span-wrapped token colors (comment/keyword/string/fn/num) — no highlighter dependency; six snippets on the whole site doesn't justify one

### Navigation

- **Brand:** Mono, tracked tight, with inline SVG mark
- **Links:** `textDim` → `text` on hover; active route gets `text` + accent underline (desktop) or full-width bottom border (mobile)
- **Mobile:** Hamburger collapse at ≤720px; links stack into a drawer on `bgRaised`
- **Theme toggle:** none — the site is light-only by design, no runtime theme switch

### Tables

- **Container:** Horizontal scroll wrapper with `border` frame and 10px radius
- **Headers:** Mono 11.5px uppercase, 0.06em tracking, `surface` background, `textFaint`
- **Cells:** 11×16px padding, `textDim`, bottom `border` rule; last row omits bottom border via `last` prop

### Landing Hero / Scroll Journey (signature)

- **Purpose:** A sticky-scroll 3D WebGPU scene (`HeroJourney`) runs behind several homepage sections, with an off-canvas live profiler readout. Reduced-motion is respected by never attaching the scroll-driven listeners in the first place, not by shortening an existing animation.
- **Legibility rule:** Any bare text block placed over the scene (hero copy, a kicker line, a `Section`'s eyebrow/title/lead) is backed by the translucent-blur scrim described in Elevation & Depth (`scrimHeader` opt-in on `Section`) — never left as flat text with nothing behind it.

## Do's and Don'ts

### Do:

- **Do** use Geist (self-hosted) exclusively — no other webfont imports for the site shell
- **Do** keep the page background pure white; express depth through hairline borders and a rare structural shadow, not a grey wash
- **Do** cap prose at 68–74ch and put wide data in scroll containers
- **Do** use mono for operational labels (eyebrows, chips, code, table headers, brand)
- **Do** keep accent usage sparse — CTAs, links, active nav, deliberate highlights
- **Do** use real elements for list markers and state (StyleX has no `::before` descendants)
- **Do** pull gap values from the static scale, never a dynamic inline `gap: n` style (CSP has no `unsafe-inline`)
- **Do** back bare text with a translucent-blur scrim wherever it sits over the sticky 3D hero scene
- **Do** label unmeasured performance as targets; disable controls that cannot produce real numbers

### Don't:

- **Don't** add shadows to `Card` or ordinary surfaces at rest — shadow is reserved for chrome that needs to read as structurally raised
- **Don't** use gradient meshes, particle effects, or WebGPU shader backgrounds as decoration
- **Don't** flood the UI with accent color — rarity is the credibility signal
- **Don't** use mint/amber/rose outside semantic contexts (status, notices, polarity lists)
- **Don't** combine `className` with `stylex.props()` — use the `sx` prop pattern
- **Don't** share StyleX breakpoints via cross-file `defineConsts` (known webpack batching bug)
- **Don't** print benchmark numbers the harness has not produced
