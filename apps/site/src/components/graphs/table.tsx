'use client'

/** Ported from mdx-graphs.kshv.me's `graph-table.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a single static
 * `graphMotion.fadeUp` per row (no stagger, no `useReducedMotion` check needed — the animation
 * already backs off under `prefers-reduced-motion`, see `motion.ts`). */

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { color } from '../../tokens.stylex'
import type { SX } from '../../ui'
import { Graph, GraphBody, GraphRule } from './frame'
import { graphMotion } from './motion'

const SM = '@media (min-width: 640px)'

type GraphAlign = 'left' | 'right'

const s = stylex.create({
  body: {
    paddingBlock: { default: 24, [SM]: 32 },
    paddingInline: { default: 12, [SM]: 24 },
  },
  scrollX: { overflowX: 'auto' },
  table: { width: '100%', minWidth: 512, borderCollapse: 'separate', borderSpacing: 0 },
  th: {
    position: 'relative',
    padding: '0 12px 12px',
    fontWeight: 400,
    whiteSpace: 'nowrap',
    color: color.text,
  },
  ruleRow: { padding: 0 },
  td: { position: 'relative', padding: '10px 12px', whiteSpace: 'nowrap' },
  footerTd: { position: 'relative', padding: '4px 12px 0', whiteSpace: 'nowrap' },
  footerRule: { paddingBlock: '8px 12px' },
  left: { textAlign: 'left' },
  right: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
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

function side(align: GraphAlign[] | undefined, index: number): GraphAlign {
  return align?.[index] ?? (index === 0 ? 'left' : 'right')
}

function RuleY() {
  return <span aria-hidden="true" {...stylex.props(s.ruleY)} />
}

export type GraphTableProps = {
  title?: string
  headers: string[]
  rows: ReactNode[][]
  footer?: ReactNode[]
  align?: GraphAlign[]
  corner?: string
  sx?: SX
}

export function GraphTable({ title, headers, rows, footer, align, corner, sx }: GraphTableProps) {
  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.body}>
        <div {...stylex.props(s.scrollX)}>
          <table {...stylex.props(s.table)}>
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={header} {...stylex.props(s.th, side(align, index) === 'right' ? s.right : s.left)}>
                    {index > 0 ? <RuleY /> : null}
                    {header}
                  </th>
                ))}
              </tr>
              <tr>
                <th colSpan={headers.length} {...stylex.props(s.ruleRow)}>
                  <GraphRule />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} {...stylex.props(graphMotion.fadeUp)}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      {...stylex.props(s.td, side(align, cellIndex) === 'right' ? s.right : s.left)}
                    >
                      {cellIndex > 0 ? <RuleY /> : null}
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer ? (
              <tfoot>
                <tr>
                  <td colSpan={headers.length} {...stylex.props(s.footerRule)}>
                    <GraphRule />
                  </td>
                </tr>
                <tr>
                  {footer.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      {...stylex.props(s.footerTd, side(align, cellIndex) === 'right' ? s.right : s.left)}
                    >
                      {cellIndex > 0 ? <RuleY /> : null}
                      {cell}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </GraphBody>
    </Graph>
  )
}
