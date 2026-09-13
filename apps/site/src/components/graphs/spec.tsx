'use client'

/** Ported from mdx-graphs.kshv.me's `graph-spec.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp`
 * per row (no stagger, no `useReducedMotion` check needed), same convention as `table.tsx`. */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone } from './motion'

const SM = '@media (min-width: 640px)'

export type SpecRow = {
  label: string
  value: string
  accent?: boolean
}

export type GraphSpecProps = {
  title?: string
  rows: SpecRow[]
  corner?: string
  sx?: SX
}

const s = stylex.create({
  list: { display: 'flex', flexDirection: 'column', gap: 12, margin: 0 },
  row: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 176px) minmax(0, 1fr)' },
    alignItems: 'baseline',
    columnGap: { default: 12, [SM]: 24 },
  },
})

export function GraphSpec({ title, rows, corner, sx }: GraphSpecProps) {
  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody>
        <dl {...stylex.props(s.list)}>
          {rows.map((row) => (
            <div key={row.label} {...stylex.props(s.row, graphMotion.fadeUp)}>
              <dt {...stylex.props(graphTone.muted)}>{row.label}</dt>
              <dd {...stylex.props(util.tabular, row.accent ? graphTone.accent : graphTone.ink)}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </GraphBody>
    </Graph>
  )
}
