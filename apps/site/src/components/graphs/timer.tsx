'use client'

/** Ported from mdx-graphs.kshv.me's `graph-timer.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `fadeUp` entrance becomes the static `graphMotion.fadeUp` style. The live
 * ticking value (via `useGraphNow`/`formatHms`/`formatAgo`/`formatClock`) is real elapsed-time
 * data refresh, not decorative motion, so it's kept as-is — no idle/looping CSS animation here. */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
import { formatAgo, formatClock, formatHms, parseInstant, useGraphNow } from './clock'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone, roleTone, type GraphPalette } from './motion'

type TimerKind = 'elapsed' | 'ago' | 'clock'

export type GraphTimerProps = {
  title?: string
  kind?: TimerKind
  at?: Date | number | string
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

export function GraphTimer({ title, kind = 'elapsed', at, caption, palette, corner, sx }: GraphTimerProps) {
  const now = useGraphNow()
  const origin = at == null ? Number.NaN : parseInstant(at)
  let value = kind === 'ago' ? '0s ago' : '00:00:00'
  let spoken = 'timer'

  if (now != null) {
    if (kind === 'clock') {
      value = formatClock(now)
      spoken = `local time ${value}`
    } else if (Number.isFinite(origin)) {
      const elapsed = Math.max(0, now - origin)
      if (kind === 'ago') {
        value = formatAgo(elapsed)
        spoken = value
      } else {
        value = formatHms(elapsed)
        spoken = `elapsed ${value}`
      }
    }
  }

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody>
        <div {...stylex.props(s.wrap, graphMotion.fadeUp)}>
          <p {...stylex.props(s.value, roleTone(palette, 'primary'))}>{value}</p>
          {caption ? <p {...stylex.props(graphTone.muted)}>{caption}</p> : null}
        </div>
        <span {...stylex.props(util.srOnly)}>{spoken}</span>
      </GraphBody>
    </Graph>
  )
}

export type { TimerKind }
