'use client'

/** Ported from mdx-graphs.kshv.me's `graph-check.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp`
 * per row (no stagger, no `useReducedMotion` check needed), same convention as `table.tsx`. */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone, roleTone, type GraphPalette } from './motion'

export type CheckItem = {
  label: string
  done?: boolean
  note?: string
}

export type GraphCheckProps = {
  title?: string
  items: CheckItem[]
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const s = stylex.create({
  list: { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1fr)',
    alignItems: 'baseline',
    columnGap: 12,
  },
  mark: { userSelect: 'none' },
  labelStack: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
})

export function GraphCheck({ title, items, palette, corner, sx }: GraphCheckProps) {
  const doneCount = items.filter((entry) => entry.done).length

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody>
        <ul role="list" {...stylex.props(s.list)}>
          {items.map((entry) => {
            const done = Boolean(entry.done)
            const mark = done ? '[x]' : '[ ]'

            return (
              <li key={entry.label} {...stylex.props(s.row, graphMotion.fadeUp)}>
                <span aria-hidden="true" {...stylex.props(s.mark, done ? roleTone(palette, 'primary') : graphTone.muted)}>
                  {mark}
                </span>
                <span {...stylex.props(s.labelStack)}>
                  <span {...stylex.props(done ? graphTone.ink : graphTone.muted)}>{entry.label}</span>
                  {entry.note ? <span {...stylex.props(graphTone.muted)}>{entry.note}</span> : null}
                </span>
              </li>
            )
          })}
        </ul>
        <span {...stylex.props(util.srOnly)}>
          {doneCount} of {items.length} done
        </span>
      </GraphBody>
    </Graph>
  )
}
