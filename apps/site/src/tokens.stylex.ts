import * as stylex from '@stylexjs/stylex'

/**
 * Design tokens. `defineVars` compiles to CSS custom properties, so these stay
 * themeable via `stylex.createTheme` if a light mode is ever added.
 *
 * StyleX requires that a `.stylex.ts` file contain ONLY `defineVars`/`defineConsts`
 * named exports — no components, no helpers, nothing else.
 */

export const color = stylex.defineVars({
  bg: '#08090b',
  bgRaised: '#0d0f13',
  surface: '#101318',
  surface2: '#151920',
  border: '#1d222b',
  borderStrong: '#2a313d',
  borderHover: '#384253',

  text: '#e7e9ee',
  textDim: '#a2aab8',
  textFaint: '#6d7686',

  accent: '#8b9dff',
  accentHover: '#9dabff',
  accentDim: '#5f70cc',
  onAccent: '#0a0c12',

  mint: '#5be9b9',
  amber: '#f0b072',
  rose: '#f08a8a',

  // Code sample tokens.
  codeText: '#cfd6e4',
  codeComment: '#5f6b7f',
  codeKeyword: '#b7a4ff',
  codeString: '#7fd8b0',
  codeFn: '#8fb7ff',
  codeNum: '#f0b072',
  codeInline: '#c8d1e2',
})

export const font = stylex.defineVars({
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Inter, Helvetica, Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
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
