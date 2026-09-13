'use client'

/** Dashed connector arrow for flow/tree-style graphs — ported from the reference's `graph-arrow.tsx`. */

import * as stylex from '@stylexjs/stylex'
import { color } from '../../tokens.stylex'
import type { SX } from '../../ui'

const s = stylex.create({
  base: { display: 'flex', minWidth: 24, alignItems: 'center', gap: 4 },
  stretch: { minWidth: 40, flex: 1 },
  accent: { color: color.accent },
  idle: { color: color.borderStrong },
  dashes: { display: 'block' },
  line: {
    height: 0,
    minWidth: 24,
    flex: 1,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: 'currentcolor',
  },
  head: { flex: 'none' },
})

export function GraphArrow({
  accent = false,
  stretch = false,
  sx,
}: {
  accent?: boolean
  stretch?: boolean
  sx?: SX
}) {
  return (
    <div
      aria-hidden="true"
      {...stylex.props(s.base, stretch && s.stretch, accent ? s.accent : s.idle, sx)}
    >
      {stretch ? <span {...stylex.props(s.line)} /> : <span {...stylex.props(s.dashes)}>- - -</span>}
      <span {...stylex.props(s.head)}>▶</span>
    </div>
  )
}
