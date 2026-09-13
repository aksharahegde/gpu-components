'use client'

/** Ported from mdx-graphs.kshv.me's `graph-flow.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp`
 * per row (no stagger, no `useReducedMotion` check needed), same convention as `table.tsx`. */

import * as stylex from '@stylexjs/stylex'
import type { SX } from '../../ui'
import { Graph, GraphBody } from './frame'
import { GraphArrow } from './arrow'
import { graphMotion, graphTone, roleTone, type GraphPalette } from './motion'

const SM = '@media (min-width: 640px)'

type FlowTone = 'default' | 'accent' | 'muted'

export type FlowNode = {
  label: string
  tone?: FlowTone
  stretch?: boolean
}

export type FlowRow = {
  nodes: FlowNode[]
}

export type GraphFlowProps = {
  title?: string
  rows: FlowRow[]
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

function nodeTone(tone: FlowTone, palette: GraphPalette | undefined) {
  if (tone === 'accent') return roleTone(palette, 'primary')
  if (tone === 'muted') return roleTone(palette, 'secondary')
  return graphTone.ink
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 28 },
  row: {
    display: 'flex',
    minWidth: 0,
    flexWrap: { default: 'wrap', [SM]: 'nowrap' },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 8,
  },
  node: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 12 },
  nodeStretch: { minWidth: 64, flex: 1 },
  label: { flex: 'none', whiteSpace: 'nowrap' },
})

export function GraphFlow({ title, rows, palette, corner, sx }: GraphFlowProps) {
  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.body}>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} {...stylex.props(s.row, graphMotion.fadeUp)}>
            {row.nodes.map((node, nodeIndex) => {
              const tone = node.tone ?? 'default'
              const live = tone === 'accent'

              return (
                <div key={`${node.label}-${nodeIndex}`} {...stylex.props(s.node, node.stretch && s.nodeStretch)}>
                  {nodeIndex > 0 ? <GraphArrow accent={live} stretch={node.stretch} /> : null}
                  <span {...stylex.props(s.label, nodeTone(tone, palette))}>{node.label}</span>
                </div>
              )
            })}
          </div>
        ))}
      </GraphBody>
    </Graph>
  )
}
