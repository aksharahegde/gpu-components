'use client'

/**
 * Ported from mdx-graphs.kshv.me's `graph-slope.tsx`. The reference staggers each `<li>` in via
 * `motion/react`; this design system bans stagger (see `./motion.ts`), so the whole list gets one
 * static `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone, roleTone, type GraphPalette } from './motion'
import type { SX } from '../../ui'

const s = stylex.create({
  head: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 6.5rem 2rem 6.5rem',
    alignItems: 'end',
    columnGap: 12,
  },
  headCell: { textAlign: 'right', margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 6.5rem 2rem 6.5rem',
    alignItems: 'baseline',
    columnGap: 12,
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  from: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  arrow: { textAlign: 'center', userSelect: 'none' },
  to: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  stack: { display: 'flex', flexDirection: 'column', gap: 12 },
})

export type SlopeItem = {
  label: string
  from: number
  to: number
}

export type GraphSlopeProps = {
  title?: string
  fromLabel: string
  toLabel: string
  items: SlopeItem[]
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

function format(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 })
}

export function GraphSlope({ title, fromLabel, toLabel, items, palette, corner, sx }: GraphSlopeProps) {
  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.stack}>
        <div {...stylex.props(s.head)}>
          <span />
          <span {...stylex.props(s.headCell, graphTone.muted)}>{fromLabel}</span>
          <span />
          <span {...stylex.props(s.headCell, graphTone.muted)}>{toLabel}</span>
        </div>
        <ul {...stylex.props(s.list, graphMotion.fadeUp)} role="list">
          {items.map((row) => {
            const up = row.to > row.from
            const down = row.to < row.from
            const tone = up ? roleTone(palette, 'primary') : down ? roleTone(palette, 'secondary') : graphTone.ink
            const arrowTone = up
              ? roleTone(palette, 'primary')
              : down
                ? roleTone(palette, 'secondary')
                : roleTone(palette, 'empty')

            return (
              <li
                key={row.label}
                aria-label={`${row.label} from ${format(row.from)} to ${format(row.to)}`}
                {...stylex.props(s.row)}
              >
                <span {...stylex.props(s.label, graphTone.ink)}>{row.label}</span>
                <span {...stylex.props(s.from, graphTone.muted)}>{format(row.from)}</span>
                <span aria-hidden="true" {...stylex.props(s.arrow, arrowTone)}>
                  {up || down ? '→' : '–'}
                </span>
                <span {...stylex.props(s.to, tone)}>{format(row.to)}</span>
              </li>
            )
          })}
        </ul>
      </GraphBody>
    </Graph>
  )
}
