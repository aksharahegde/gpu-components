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
  // Pure white page. Structure comes from hairline borders and type weight,
  // not from a grey wash — every grey added here is contrast taken away from
  // the GPU canvases, which are the reason anyone is on the page.
  bg: '#ffffff',
  bgRaised: '#fbfbfc',
  surface: '#ffffff',
  surface2: '#f4f5f7',
  border: '#e8e9ed',
  borderStrong: '#d6d8de',
  borderHover: '#b9bcc6',

  text: '#0d0f14',
  textDim: '#5a6070',
  textFaint: '#6a7080',

  accent: '#3d4fd6',
  accentHover: '#2f40c4',
  // Tints and status dots only — 2.3:1, never legal as text.
  accentDim: '#a8b1f0',
  onAccent: '#ffffff',

  mint: '#0e7c58',
  amber: '#92590a',
  rose: '#c02b2b',

  // Code sample tokens.
  codeText: '#1f2430',
  codeComment: '#6a7080',
  codeKeyword: '#6d28d9',
  codeString: '#0f7a51',
  codeFn: '#1d4ed8',
  codeNum: '#92590a',
  codeInline: '#2b3140',
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
  sm: '5px',
  md: '8px',
  lg: '10px',
  pill: '999px',
})

export const size = stylex.defineVars({
  maxWidth: '1120px',
  gutter: '24px',
  navHeight: '58px',
})
