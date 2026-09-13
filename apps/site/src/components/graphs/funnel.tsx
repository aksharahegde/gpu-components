'use client'

/**
 * ASCII step-funnel — ported from mdx-graphs.kshv.me's `graph-funnel.tsx`. The reference staggers
 * each row in on scroll via a `motion.ol`/`motion.li` variant list; this design system bans
 * per-item stagger machinery, so rows render in their final state and the whole graph gets one
 * `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import {
  graphMotion,
  graphTone,
  isMonoPalette,
  seriesDimStyle,
  seriesTone,
  trackMarks,
  type Glyphs,
  type GraphPalette,
} from './motion'
import { util } from '../../ui'

const SM = '@media (min-width: 640px)'

type FunnelStep = {
  label: string
  value: number
  display?: string
}

type GraphFunnelProps = {
  title?: string
  steps: FunnelStep[]
  ticks?: number
  stage?: string
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
}

const s = stylex.create({
  list: { display: 'flex', flexDirection: 'column', gap: 12, margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0,7rem) minmax(0,1fr) minmax(0,8ch) minmax(0,4ch)',
    alignItems: 'center',
    columnGap: { default: 8, [SM]: 16 },
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  value: { textAlign: 'right' },
  percent: { textAlign: 'right' },
})

export function GraphFunnel({ title, steps, ticks = 20, stage, glyphs, palette, corner }: GraphFunnelProps) {
  const max = Math.max(...steps.map((step) => step.value), 1)
  const head = steps[0]?.value || 1
  const marks = trackMarks(glyphs)

  return (
    <Graph title={title} corner={corner} sx={graphMotion.fadeUp}>
      <GraphBody>
        <ol {...stylex.props(s.list)} role="list">
          {steps.map((step, index) => {
            const width = Math.max(1, Math.round((step.value / max) * ticks))
            const percent = Math.round((step.value / head) * 100)
            const focused = Boolean(stage) && step.label === stage
            const dim = Boolean(stage) && !focused

            return (
              <li key={step.label} {...stylex.props(s.row, seriesDimStyle(palette, !dim))}>
                <span {...stylex.props(s.label, graphTone.ink)}>{step.label}</span>
                <GraphTrack>
                  {Array.from({ length: ticks }, (_, cell) => {
                    const filled = cell < width
                    const tone = filled
                      ? isMonoPalette(palette)
                        ? graphTone.accent
                        : seriesTone(palette, index)
                      : graphTone.frame

                    return (
                      <GraphTick key={cell} sx={tone}>
                        {filled ? marks.fill : marks.empty}
                      </GraphTick>
                    )
                  })}
                </GraphTrack>
                <span {...stylex.props(s.value, util.tabular, graphTone.ink)}>
                  {step.display ?? step.value.toLocaleString()}
                </span>
                <span {...stylex.props(s.percent, util.tabular, graphTone.muted)}>
                  {index === 0 ? '' : `${percent}%`}
                </span>
              </li>
            )
          })}
        </ol>
      </GraphBody>
    </Graph>
  )
}

export type { FunnelStep, GraphFunnelProps }
