import * as stylex from '@stylexjs/stylex'

/**
 * Design tokens. `defineVars` compiles to CSS custom properties.
 *
 * The site is light-only. There is no `createTheme` override and no runtime
 * theme switch — these values are the palette, not a default for one. Every
 * colour here clears WCAG AA (4.5:1) against the surface it is used on at its
 * smallest real size, which is 11px: `demos/chrome.tsx` renders field labels
 * and panel titles that small, so `textFaint` is a working text colour rather
 * than decoration and is contrast-bound accordingly.
 *
 * IMPORTANT: `app/globals.css` carries a byte-exact copy of this file's
 * compiled `:root` output, working around an upstream StyleX/webpack batching
 * bug documented there. Editing this file without regenerating that block
 * leaves every token resolving to nothing. The regeneration command is in
 * `globals.css`'s comment — run it, do not hand-edit.
 *
 * StyleX requires that a `.stylex.ts` file contain ONLY `defineVars`/`defineConsts`
 * named exports — no components, no helpers, nothing else.
 */

export const color = stylex.defineVars({
  // Near-white page (mdx-graphs.kshv.me's light-mode ground, not pure #fff).
  // Structure comes from hairline borders and type weight, not from a grey
  // wash — every grey added here is contrast taken away from the GPU
  // canvases, which are the reason anyone is on the page.
  //
  // Grayscale-plus-one-accent: neutrals run #171717 (ink) through #fafafa
  // (ground), with a single teal accent (#006e92) for links/CTAs/focus.
  // `mint`/`amber`/`rose` keep their names but are now neutrals-with-a-red-
  // exception — mint/amber are mid/dark grays, rose is the one saturated
  // color left, reserved for negative/error state.
  bg: '#fafafa',
  bgRaised: '#f2f2f2',
  surface: '#fafafa',
  surface2: '#f2f2f2',
  border: 'rgba(23, 23, 23, 0.08)',
  borderStrong: '#d7d7d7',
  borderHover: '#b1b1b1',

  text: '#171717',
  textDim: '#292929',
  textFaint: '#585858',

  accent: '#006e92',
  accentHover: '#0066ac',
  // Tints and status dots only — not legal as text.
  accentDim: '#868686',
  onAccent: '#ffffff',

  mint: '#636363',
  amber: '#404040',
  rose: '#e40014',

  // Code sample tokens.
  codeText: '#262626',
  codeComment: '#767676',
  codeKeyword: '#171717',
  codeString: '#525252',
  codeFn: '#006e92',
  codeNum: '#636363',
  codeInline: '#262626',
})

/**
 * Geist, self-hosted by `next/font` via the `geist` package — `app/layout.tsx`
 * puts `--font-geist-sans` / `--font-geist-mono` on `<html>`. The stacks below
 * stay as fallbacks for the swap window and for the `out/` HTML if the font
 * assets ever fail to load.
 */
export const font = stylex.defineVars({
  sans: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
})

/**
 * Elevation. The dark palette got depth from glows and colour-mix; on white
 * that reads as a smudge, so depth is a shadow scale instead. Used sparingly —
 * flat plus a hairline border is the default for `Card`.
 */
export const shadow = stylex.defineVars({
  sm: '0 1px 2px rgba(13, 15, 20, 0.04)',
  md: '0 4px 16px -4px rgba(13, 15, 20, 0.08)',
  lg: '0 12px 32px -8px rgba(13, 15, 20, 0.10)',
})

export const radius = stylex.defineVars({
  sm: '0px',
  md: '0px',
  lg: '0px',
  pill: '0px',
})

export const size = stylex.defineVars({
  maxWidth: '1152px',
  gutter: '24px',
  navHeight: '58px',
})
