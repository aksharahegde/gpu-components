'use client'

/** Ported from mdx-graphs.kshv.me's `graph-matrix.tsx` — a label + numeric-columns grid with an
 * optional "live" row (accent) that dims every other row. Framer Motion's `staggerList`/`fadeUp`
 * become a static `graphMotion.fadeUp` per row. */

import * as stylex from '@stylexjs/stylex'
import { color } from '../../tokens.stylex'
import { util } from '../../ui'
import type { SX } from '../../ui'
import { Graph, GraphBody, GraphRule } from './frame'
import { graphFx, graphMotion, graphTone, roleTone, type GraphPalette } from './motion'

export type MatrixRow = {
  label: string
  values: (number | string)[]
}

export type GraphMatrixProps = {
  title?: string
  columns: string[]
  rows: MatrixRow[]
  accent?: string
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const s = stylex.create({
  scrollX: { overflowX: 'auto' },
  col: { display: 'flex', minWidth: 512, flexDirection: 'column' },
  headRow: { display: 'grid', alignItems: 'end' },
  headCell: { position: 'relative', padding: '0 12px 12px', textAlign: 'right' },
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  row: { display: 'grid', alignItems: 'baseline' },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '10px 12px 10px 0',
    color: color.text,
  },
  cell: {
    position: 'relative',
    padding: '10px 12px',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: color.text,
  },
  ruleY: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'dashed',
    borderInlineStartColor: color.border,
  },
})

function formatCell(value: number | string) {
  if (typeof value === 'number') {
    return value.toLocaleString('en-US', {
      maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
    })
  }
  return value
}

function RuleY() {
  return <span aria-hidden="true" {...stylex.props(s.ruleY)} />
}

export function GraphMatrix({ title, columns, rows, accent, palette, corner, sx }: GraphMatrixProps) {
  const template = `minmax(6rem, 1fr) repeat(${columns.length}, minmax(4.5rem, 7rem))`

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.scrollX}>
        <div {...stylex.props(s.col)}>
          <div {...stylex.props(s.headRow)} style={{ gridTemplateColumns: template }}>
            <span />
            {columns.map((column) => (
              <span key={column} {...stylex.props(s.headCell, graphTone.muted)}>
                <RuleY />
                {column}
              </span>
            ))}
          </div>
          <GraphRule />
          <ul {...stylex.props(s.list)} role="list">
            {rows.map((row) => {
              const live = Boolean(accent) && row.label === accent
              const dim = Boolean(accent) && !live

              return (
                <li
                  key={row.label}
                  {...stylex.props(s.row, graphMotion.fadeUp, dim && graphFx.dim)}
                  style={{ gridTemplateColumns: template }}
                >
                  <span {...stylex.props(s.label, live && roleTone(palette, 'primary'))}>{row.label}</span>
                  {columns.map((column, index) => (
                    <span
                      key={`${row.label}-${column}`}
                      {...stylex.props(s.cell, live && roleTone(palette, 'primary'))}
                    >
                      <RuleY />
                      {formatCell(row.values[index] ?? '')}
                    </span>
                  ))}
                </li>
              )
            })}
          </ul>
        </div>
        <span {...stylex.props(util.srOnly)}>
          Matrix with {rows.length} rows and {columns.length} columns
        </span>
      </GraphBody>
    </Graph>
  )
}
