'use client'

/**
 * Ported from mdx-graphs.kshv.me's `graph-diff.tsx`. The reference staggers each row in via
 * `motion/react`; this design system bans stagger (see `./motion.ts`), so the whole list (and the
 * footer row) gets one static `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphRule } from './frame'
import { graphMotion, graphTone, roleTone, type GraphPalette } from './motion'
import type { SX } from '../../ui'

const s = stylex.create({
  list: { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
  stack: { display: 'flex', flexDirection: 'column', gap: 12 },
  row: {
    display: 'grid',
    gridTemplateColumns: '1.25rem minmax(0, 1fr) 8ch',
    alignItems: 'baseline',
    columnGap: 12,
  },
  sign: { textAlign: 'center', userSelect: 'none' },
  value: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
})

export type DiffSign = 'add' | 'remove' | 'keep'

export type DiffRow = {
  label: string
  value: string
  sign?: DiffSign
}

export type GraphDiffProps = {
  title?: string
  rows: DiffRow[]
  footer?: DiffRow
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const signGlyph: Record<DiffSign, string> = {
  add: '+',
  remove: '-',
  keep: ' ',
}

function DiffLine({ row, palette }: { row: DiffRow; palette?: GraphPalette }) {
  const sign = row.sign ?? 'keep'
  const tone =
    sign === 'add'
      ? roleTone(palette, 'primary')
      : sign === 'remove'
        ? roleTone(palette, 'secondary')
        : sign === 'keep'
          ? graphTone.ink
          : roleTone(palette, 'empty')
  const mark = sign === 'keep' ? roleTone(palette, 'empty') : tone

  return (
    <div {...stylex.props(s.row)}>
      <span aria-hidden="true" {...stylex.props(s.sign, mark)}>
        {signGlyph[sign]}
      </span>
      <span {...stylex.props(tone)}>{row.label}</span>
      <span {...stylex.props(s.value, tone)}>{row.value}</span>
    </div>
  )
}

export function GraphDiff({ title, rows, footer, palette, corner, sx }: GraphDiffProps) {
  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.stack}>
        <ul {...stylex.props(s.list, graphMotion.fadeUp)} role="list">
          {rows.map((row) => (
            <li key={row.label}>
              <DiffLine row={row} palette={palette} />
            </li>
          ))}
        </ul>
        {footer ? (
          <>
            <GraphRule />
            <div {...stylex.props(graphMotion.fadeUp)}>
              <DiffLine row={footer} palette={palette} />
            </div>
          </>
        ) : null}
      </GraphBody>
    </Graph>
  )
}
