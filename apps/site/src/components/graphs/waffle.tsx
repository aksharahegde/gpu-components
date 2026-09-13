'use client'

/**
 * ASCII waffle/percentage grid — ported from mdx-graphs.kshv.me's `graph-waffle.tsx`. The reference
 * fades each cell in on scroll with a per-cell stagger delay; this design system bans that idle
 * per-item reveal machinery, so cells render in their final filled/empty state and the whole graph
 * gets one `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone, roleTone, trackMarks, type Glyphs, type GraphPalette } from './motion'
import { util } from '../../ui'

type GraphWaffleProps = {
  title?: string
  value: number
  cells?: number
  columns?: number
  caption?: string
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 16 },
  grid: { display: 'flex', width: '100%', flexDirection: 'column', gap: 4, userSelect: 'none' },
  row: { display: 'flex', width: '100%' },
  cell: { minWidth: '1ch', flex: 1, textAlign: 'center' },
})

export function GraphWaffle({
  title,
  value,
  cells = 100,
  columns = 10,
  caption,
  glyphs,
  palette,
  corner,
}: GraphWaffleProps) {
  const clamped = Math.min(1, Math.max(0, value))
  const filled = Math.round(clamped * cells)
  const rows = Math.ceil(cells / columns)
  const marks = trackMarks(glyphs, { empty: '░', rest: '░', fill: '█' })
  const primary = roleTone(palette, 'primary')
  const percent = Math.round(clamped * 100)

  return (
    <Graph title={title} corner={corner} sx={graphMotion.fadeUp}>
      <GraphBody sx={s.body}>
        <div aria-hidden="true" {...stylex.props(s.grid)}>
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} {...stylex.props(s.row)}>
              {Array.from({ length: columns }, (_, column) => {
                const index = row * columns + column
                if (index >= cells) {
                  return <span key={column} {...stylex.props(s.cell)} />
                }
                const isFilled = index < filled

                return (
                  <span key={column} {...stylex.props(s.cell, isFilled ? primary : graphTone.frame)}>
                    {isFilled ? marks.fill : marks.empty}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
        <p {...stylex.props(util.tabular, primary)}>{percent}%</p>
        {caption ? <p {...stylex.props(graphTone.muted)}>{caption}</p> : null}
        <span {...stylex.props(util.srOnly)}>
          {percent} percent
          {caption ? `. ${caption}` : ''}
        </span>
      </GraphBody>
    </Graph>
  )
}

export type { GraphWaffleProps }
