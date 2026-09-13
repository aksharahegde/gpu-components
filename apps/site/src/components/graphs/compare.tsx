'use client'

/** Ported from mdx-graphs.kshv.me's `graph-compare.tsx` — a columns-of-features comparison grid
 * (check/dash marks or text cells), with an optional focused column that dims the rest. Framer
 * Motion's `staggerList`/`fadeUp` become a static `graphMotion.fadeUp` per row. */

import * as stylex from '@stylexjs/stylex'
import { color } from '../../tokens.stylex'
import type { SX } from '../../ui'
import { Graph, GraphBody } from './frame'
import { graphFx, graphMotion, graphTone, isMonoPalette, seriesTone, type GraphPalette } from './motion'

export type CompareCell = string | boolean

export type CompareRow = {
  label: string
  values: CompareCell[]
}

export type GraphCompareProps = {
  title?: string
  columns: string[]
  rows: CompareRow[]
  accent?: string
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const s = stylex.create({
  scrollX: { overflowX: 'auto' },
  col: { display: 'flex', minWidth: 512, flexDirection: 'column', gap: 12 },
  headRow: { display: 'grid', alignItems: 'end', columnGap: 16 },
  headCell: { textAlign: 'right' },
  list: { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
  row: { display: 'grid', alignItems: 'baseline', columnGap: 16 },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: color.text },
  cell: { textAlign: 'right' },
  tabular: { fontVariantNumeric: 'tabular-nums' },
})

function cellText(value: CompareCell) {
  if (typeof value === 'boolean') return value ? '✓' : '–'
  return value
}

export function GraphCompare({ title, columns, rows, accent, palette, corner, sx }: GraphCompareProps) {
  const template = `minmax(7rem,1fr) repeat(${columns.length}, minmax(4.5rem, 7rem))`
  const hasAccent = Boolean(accent)
  const mono = isMonoPalette(palette)

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.scrollX}>
        <div {...stylex.props(s.col)}>
          <div {...stylex.props(s.headRow)} style={{ gridTemplateColumns: template }}>
            <span />
            {columns.map((column, index) => {
              const focused = hasAccent && column === accent
              const tone = mono ? (focused ? graphTone.accent : graphTone.muted) : seriesTone(palette, index)
              return (
                <span key={column} {...stylex.props(s.headCell, tone)}>
                  {column}
                </span>
              )
            })}
          </div>
          <ul {...stylex.props(s.list)} role="list">
            {rows.map((row) => (
              <li
                key={row.label}
                {...stylex.props(s.row, graphMotion.fadeUp)}
                style={{ gridTemplateColumns: template }}
              >
                <span {...stylex.props(s.label)}>{row.label}</span>
                {columns.map((column, index) => {
                  const value = row.values[index]
                  const focused = hasAccent && column === accent
                  const dim = hasAccent && !focused
                  const mark = typeof value === 'boolean'
                  const on = value === true

                  let tone
                  if (mark) {
                    tone = on
                      ? mono
                        ? focused || !hasAccent
                          ? graphTone.accent
                          : graphTone.ink
                        : seriesTone(palette, index)
                      : graphTone.frame
                  } else if (focused) {
                    tone = graphTone.ink
                  } else if (dim) {
                    tone = graphTone.muted
                  }

                  const dimOpacity = dim && !on && mono ? graphFx.dim : undefined

                  return (
                    <span
                      key={`${row.label}-${column}`}
                      {...stylex.props(s.cell, !mark && s.tabular, tone, dimOpacity)}
                    >
                      {value == null ? '' : cellText(value)}
                    </span>
                  )
                })}
              </li>
            ))}
          </ul>
        </div>
      </GraphBody>
    </Graph>
  )
}
