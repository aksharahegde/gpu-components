'use client'

/** Ported from mdx-graphs.kshv.me's `graph-tree.tsx` onto StyleX + the shared `Graph` frame —
 * the reference draws its branch lines as plain `├─`/`└─`/`│` glyphs (no `GraphArrow` connector
 * involved), so this port keeps that same flattened-ASCII-tree structure. Framer Motion's
 * `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp` per row (no
 * stagger, no `useReducedMotion` check needed), same convention as `table.tsx`. */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
import { Graph, GraphBody } from './frame'
import { graphFx, graphMotion, graphTone } from './motion'

export type TreeNode = {
  label: string
  meta?: string
  accent?: boolean
  children?: TreeNode[]
}

export type GraphTreeProps = {
  title?: string
  nodes: TreeNode[]
  corner?: string
  sx?: SX
}

type FlatRow = {
  key: string
  branch: string
  label: string
  meta?: string
  accent?: boolean
}

function flatten(nodes: TreeNode[], prefix = '', trail = 'root', isRoot = true): FlatRow[] {
  const singleRoot = isRoot && nodes.length === 1

  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1
    const branch = singleRoot ? '' : prefix + (last ? '└─ ' : '├─ ')
    const key = `${trail}/${node.label}-${index}`
    const childPrefix = singleRoot ? '' : prefix + (last ? '   ' : '│  ')
    const row: FlatRow = {
      key,
      branch,
      label: node.label,
      meta: node.meta,
      accent: node.accent,
    }
    const kids = node.children ? flatten(node.children, childPrefix, key, false) : []
    return [row, ...kids]
  })
}

const s = stylex.create({
  scrollX: { overflowX: 'auto' },
  list: { display: 'flex', minWidth: 'max-content', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'baseline',
    columnGap: 24,
  },
  branch: { whiteSpace: 'nowrap' },
  branchMark: { userSelect: 'none' },
})

export function GraphTree({ title, nodes, corner, sx }: GraphTreeProps) {
  const rows = flatten(nodes)
  const hasAccent = rows.some((row) => row.accent)

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.scrollX}>
        <ul role="list" {...stylex.props(s.list)}>
          {rows.map((row) => {
            const dim = hasAccent && !row.accent

            return (
              <li key={row.key} {...stylex.props(s.row, graphMotion.fadeUp, dim && graphFx.dim)}>
                <span {...stylex.props(s.branch)}>
                  <span aria-hidden="true" {...stylex.props(s.branchMark, graphTone.frame)}>
                    {row.branch}
                  </span>
                  <span {...stylex.props(row.accent ? graphTone.accent : graphTone.ink)}>{row.label}</span>
                </span>
                {row.meta ? <span {...stylex.props(graphTone.muted, util.tabular)}>{row.meta}</span> : <span />}
              </li>
            )
          })}
        </ul>
        <span {...stylex.props(util.srOnly)}>Tree with {rows.length} nodes</span>
      </GraphBody>
    </Graph>
  )
}
