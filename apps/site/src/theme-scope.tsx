'use client'

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useTheme } from './theme'
import { color, font } from './tokens.stylex'
import { lightColor } from './theme.stylex'

const s = stylex.create({
  app: {
    backgroundColor: color.bg,
    color: color.text,
    fontFamily: font.sans,
    fontSize: 16,
    lineHeight: 1.65,
    minHeight: '100vh',
    WebkitFontSmoothing: 'antialiased',
  },
})

/** Applies the light-theme StyleX var override to the app root. See `theme.tsx`. */
export function ThemeScope({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  return <div {...stylex.props(s.app, theme === 'light' && lightColor)}>{children}</div>
}
