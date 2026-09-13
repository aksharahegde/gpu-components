'use client'

/**
 * Ported from mdx-graphs.kshv.me's `graph-stat.tsx`. The reference staggers each `<li>` in via
 * `motion/react`; this design system bans stagger (see `./motion.ts`), so the whole grid gets one
 * static `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone } from './motion'
import type { SX } from '../../ui'

const SM = '@media (min-width: 640px)'

const columnTemplate: Record<number, string> = {
  1: 'minmax(0, 1fr)',
  2: 'repeat(2, minmax(0, 1fr))',
  3: 'repeat(3, minmax(0, 1fr))',
  4: 'repeat(4, minmax(0, 1fr))',
}

const s = stylex.create({
  list: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 32,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  cols1: { gridTemplateColumns: { default: 'minmax(0, 1fr)', [SM]: columnTemplate[1] } },
  cols2: { gridTemplateColumns: { default: 'minmax(0, 1fr)', [SM]: columnTemplate[2] } },
  cols3: { gridTemplateColumns: { default: 'minmax(0, 1fr)', [SM]: columnTemplate[3] } },
  cols4: { gridTemplateColumns: { default: 'minmax(0, 1fr)', [SM]: columnTemplate[4] } },
  item: { display: 'flex', flexDirection: 'column', gap: 8 },
  value: {
    fontSize: { default: 30, [SM]: 36 },
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    margin: 0,
  },
  meta: { margin: 0 },
})

const colsStyle = { 1: s.cols1, 2: s.cols2, 3: s.cols3, 4: s.cols4 } as const

export type StatItem = {
  value: string
  label: string
  hint?: string
  accent?: boolean
}

export type GraphStatProps = {
  title?: string
  items: StatItem[]
  corner?: string
  sx?: SX
}

export function GraphStat({ title, items, corner, sx }: GraphStatProps) {
  const columns = Math.min(items.length, 4) as 1 | 2 | 3 | 4

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody>
        <ul {...stylex.props(s.list, colsStyle[columns] ?? s.cols4, graphMotion.fadeUp)} role="list">
          {items.map((entry) => (
            <li key={entry.label} {...stylex.props(s.item)}>
              <p {...stylex.props(s.value, entry.accent ? graphTone.accent : graphTone.ink)}>{entry.value}</p>
              <p {...stylex.props(s.meta, graphTone.muted)}>{entry.label}</p>
              {entry.hint ? <p {...stylex.props(s.meta, graphTone.muted)}>{entry.hint}</p> : null}
            </li>
          ))}
        </ul>
      </GraphBody>
    </Graph>
  )
}
