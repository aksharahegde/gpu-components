'use client'

/** Ported from mdx-graphs.kshv.me's `graph-cells.tsx` — small glyph grids (e.g. a bitmap-style
 * "on/off" pattern) labeled underneath. The reference staggers each cell's fade-in by grid
 * position via Framer Motion; that per-cell stagger is dropped for a single static
 * `graphMotion.fadeUp` applied to the whole grid, per the port's no-stagger convention. */

import * as stylex from '@stylexjs/stylex'
import type { SX } from '../../ui'
import { Graph, GraphBody } from './frame'
import {
  graphMotion,
  graphTone,
  isMonoPalette,
  seriesTone,
  trackMarks,
  type GraphPalette,
  type Glyphs,
} from './motion'

const WIDE = '@media (min-width: 448px)'

export type CellGrid = {
  label: string
  cells: number[][]
}

export type GraphCellsProps = {
  title?: string
  items: CellGrid[]
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const s = stylex.create({
  wrap: {
    display: 'flex',
    flexDirection: { default: 'column', [WIDE]: 'row' },
    alignItems: 'center',
    justifyContent: { default: 'flex-start', [WIDE]: 'center' },
    gap: { default: 40, [WIDE]: 48 },
  },
  item: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
  grid: { display: 'flex', flexDirection: 'column', gap: 4 },
  row: { display: 'flex', gap: 4 },
  cell: { width: '1ch', textAlign: 'center', userSelect: 'none' },
})

export function GraphCells({ title, items, glyphs, palette, corner, sx }: GraphCellsProps) {
  const marks = trackMarks(glyphs, { empty: '·', rest: '░', fill: '█' })

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody>
        <div {...stylex.props(s.wrap)}>
          {items.map((item, itemIndex) => (
            <div key={item.label} {...stylex.props(s.item)}>
              <div aria-hidden="true" {...stylex.props(s.grid)}>
                {item.cells.map((row, rowIndex) => (
                  <div key={rowIndex} {...stylex.props(s.row)}>
                    {row.map((cell, cellIndex) => {
                      const filled = cell === 1
                      const tone = filled
                        ? isMonoPalette(palette)
                          ? graphTone.accent
                          : seriesTone(palette, itemIndex)
                        : graphTone.frame

                      return (
                        <span key={cellIndex} {...stylex.props(s.cell, tone, filled && graphMotion.fadeUp)}>
                          {filled ? marks.fill : marks.empty}
                        </span>
                      )
                    })}
                  </div>
                ))}
              </div>
              <p {...stylex.props(isMonoPalette(palette) ? graphTone.muted : seriesTone(palette, itemIndex))}>
                {item.label}
              </p>
            </div>
          ))}
        </div>
      </GraphBody>
    </Graph>
  )
}
