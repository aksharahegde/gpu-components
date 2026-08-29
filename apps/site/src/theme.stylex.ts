import * as stylex from '@stylexjs/stylex'
import { color } from './tokens.stylex'

/**
 * Light-mode override for the `color` vars in `tokens.stylex.ts`. Applied via
 * `stylex.props(lightColor)` on the app root when the light theme is active —
 * see `theme.tsx`. Kept in its own `.stylex.ts` file for the same reason
 * `tokens.stylex.ts` stays vars-only: this file must contain only a
 * `createTheme` export.
 */
export const lightColor = stylex.createTheme(color, {
  bg: '#f7f8fa',
  bgRaised: '#ffffff',
  surface: '#ffffff',
  surface2: '#eef0f4',
  border: '#e1e4ea',
  borderStrong: '#cad0d9',
  borderHover: '#aeb6c4',

  text: '#12151b',
  textDim: '#454c59',
  textFaint: '#727a89',

  accent: '#4a5bd4',
  accentHover: '#3949bd',
  accentDim: '#8f9fef',
  onAccent: '#ffffff',

  mint: '#0f8a5f',
  amber: '#a15c00',
  rose: '#c23f3f',

  codeText: '#232a37',
  codeComment: '#7b8494',
  codeKeyword: '#7c3aed',
  codeString: '#0f7a51',
  codeFn: '#2454b3',
  codeNum: '#a15c00',
  codeInline: '#333a48',
})
