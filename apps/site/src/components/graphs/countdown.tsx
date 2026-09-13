'use client'

/** Ported from mdx-graphs.kshv.me's `graph-countdown.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `fadeUp` entrance becomes the static `graphMotion.fadeUp` style. The live
 * countdown (via `useGraphNow`/`formatHms`) is real elapsed-time data refresh, not decorative
 * motion, so it's kept as-is — no idle/looping CSS animation here. */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
import { formatHms, parseInstant, useGraphNow } from './clock'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone, roleTone, type GraphPalette } from './motion'

export type GraphCountdownProps = {
  title?: string
  to: Date | number | string
  done?: string
  caption?: string
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const SM = '@media (min-width: 640px)'

const s = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  value: {
    fontSize: { default: 30, [SM]: 36 },
    letterSpacing: '-0.025em',
    fontVariantNumeric: 'tabular-nums',
  },
})

export function GraphCountdown({ title, to, done = 'done', caption, palette, corner, sx }: GraphCountdownProps) {
  const now = useGraphNow()
  const target = parseInstant(to)
  const remaining = now == null || !Number.isFinite(target) ? null : target - now
  const finished = remaining != null && remaining <= 0
  const value = remaining == null ? '00:00:00' : finished ? done : formatHms(remaining)

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody>
        <div {...stylex.props(s.wrap, graphMotion.fadeUp)}>
          <p {...stylex.props(s.value, finished ? graphTone.muted : roleTone(palette, 'primary'))}>{value}</p>
          {caption ? <p {...stylex.props(graphTone.muted)}>{caption}</p> : null}
        </div>
        <span {...stylex.props(util.srOnly)}>{finished ? done : `remaining ${value}`}</span>
      </GraphBody>
    </Graph>
  )
}
