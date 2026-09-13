'use client'

/**
 * Mini before/after bar-chart pair — ported from mdx-graphs.kshv.me's `graph-bars.tsx`. The
 * reference reveals each cell with a `motion.span` fade driven by scroll + per-column stagger
 * delay (`fillDelay`); this site bans looping/idle motion and per-item stagger machinery, so cells
 * render in their final state and the whole graph gets one `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody } from './frame'
import { GraphArrow } from './arrow'
import { graphMotion, graphTone, roleTone, trackMarks, type Glyphs, type GraphPalette } from './motion'

const SM = '@media (min-width: 640px)'

type BarSeries = {
  label: string
  values: number[]
  size?: 'sm' | 'lg'
}

type GraphBarsProps = {
  title?: string
  from: BarSeries
  to: BarSeries
  processor?: string
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
}

const s = stylex.create({
  wrap: {
    display: 'flex',
    flexDirection: { default: 'column', [SM]: 'row' },
    alignItems: { default: 'center', [SM]: 'flex-end' },
    justifyContent: { default: 'flex-start', [SM]: 'center' },
    gap: 32,
  },
  col: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  barsRow: { display: 'flex', alignItems: 'flex-end', gap: 4 },
  colBar: { display: 'flex', width: '1ch', flexDirection: 'column', justifyContent: 'flex-end' },
  cell: { height: '1em', width: '100%', textAlign: 'center' },
  hidden: { color: 'transparent' },
  arrowWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    transform: { default: 'rotate(90deg)', [SM]: 'none' },
  },
})

function MiniBars({
  values,
  height,
  tone = 'accent',
  fill,
  palette,
}: {
  values: number[]
  height: number
  tone?: 'accent' | 'muted'
  fill: string
  palette?: GraphPalette
}) {
  const max = Math.max(...values, 1)
  const toneStyle = tone === 'accent' ? roleTone(palette, 'primary') : roleTone(palette, 'secondary')

  return (
    <div {...stylex.props(s.barsRow)}>
      {values.map((value, index) => {
        const level = Math.round((value / max) * (height - 1))

        return (
          <span key={index} {...stylex.props(s.colBar)}>
            {Array.from({ length: height }, (_, row) => {
              const fromBottom = height - 1 - row
              const on = fromBottom <= level

              return (
                <span key={row} {...stylex.props(s.cell, on ? toneStyle : s.hidden)}>
                  {on ? fill : ' '}
                </span>
              )
            })}
          </span>
        )
      })}
    </div>
  )
}

export function GraphBars({ title, from, to, processor, glyphs, palette, corner }: GraphBarsProps) {
  const marks = trackMarks(glyphs)
  const fromHeight = from.size === 'lg' ? 8 : 5
  const toHeight = to.size === 'lg' ? 8 : 5

  return (
    <Graph title={title} corner={corner} sx={graphMotion.fadeUp}>
      <GraphBody>
        <div {...stylex.props(s.wrap)}>
          <div {...stylex.props(s.col)}>
            <MiniBars fill={marks.fill} height={fromHeight} palette={palette} tone="muted" values={from.values} />
            <p {...stylex.props(roleTone(palette, 'secondary'))}>{from.label}</p>
          </div>

          <div {...stylex.props(s.arrowWrap, graphTone.muted)}>
            <GraphArrow />
            {processor ? <span>{processor}</span> : null}
            <GraphArrow />
          </div>

          <div {...stylex.props(s.col)}>
            <MiniBars fill={marks.fill} height={toHeight} palette={palette} values={to.values} />
            <p {...stylex.props(graphTone.ink)}>{to.label}</p>
          </div>
        </div>
      </GraphBody>
    </Graph>
  )
}

export type { BarSeries, GraphBarsProps }
