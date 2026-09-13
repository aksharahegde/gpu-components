'use client'

/** Ported from mdx-graphs.kshv.me's `graph-sheet.tsx` — a sectioned variant of `GraphTable` (each
 * section gets its own muted label row and, after the first, a divider). Framer Motion's stagger
 * is dropped for a static `graphMotion.fadeUp` per row, as in `table.tsx`. */

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { color } from '../../tokens.stylex'
import type { SX } from '../../ui'
import { Graph, GraphBody, GraphRule } from './frame'
import { graphMotion, graphTone } from './motion'

const SM = '@media (min-width: 640px)'

export type GraphAlign = 'left' | 'right'

export type SheetSection = {
  title: string
  rows: ReactNode[][]
}

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
  sectionRule: { paddingBlock: '16px 4px' },
  sectionLabel: { padding: '12px 12px 4px' },
  td: { position: 'relative', padding: '10px 12px', whiteSpace: 'nowrap' },
  footerTd: { position: 'relative', padding: '4px 12px 0', whiteSpace: 'nowrap' },
  footerRule: { paddingBlock: '12px 12px' },
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

export type GraphSheetProps = {
  title?: string
  headers: string[]
  sections: SheetSection[]
  footer?: ReactNode[]
  align?: GraphAlign[]
  corner?: string
  sx?: SX
}

export function GraphSheet({ title, headers, sections, footer, align, corner, sx }: GraphSheetProps) {
  const columns = headers.length

  function cellSx(index: number) {
    return [s.td, side(align, index) === 'right' ? s.right : s.left]
  }

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
                <th colSpan={columns} {...stylex.props(s.ruleRow)}>
                  <GraphRule />
                </th>
              </tr>
            </thead>
            {sections.map((section, sectionIndex) => (
              <tbody key={section.title}>
                {sectionIndex > 0 ? (
                  <tr>
                    <td colSpan={columns} {...stylex.props(s.sectionRule)}>
                      <GraphRule />
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={columns} {...stylex.props(s.sectionLabel, graphTone.muted)}>
                    {section.title}
                  </td>
                </tr>
                {section.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} {...stylex.props(graphMotion.fadeUp)}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} {...stylex.props(cellSx(cellIndex))}>
                        {cellIndex > 0 ? <RuleY /> : null}
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
            {footer ? (
              <tfoot>
                <tr>
                  <td colSpan={columns} {...stylex.props(s.footerRule)}>
                    <GraphRule />
                  </td>
                </tr>
                <tr>
                  {footer.map((cell, cellIndex) => (
                    <td key={cellIndex} {...stylex.props(cellSx(cellIndex))}>
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
