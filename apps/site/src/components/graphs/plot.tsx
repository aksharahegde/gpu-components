'use client'

/**
 * ASCII line/area plot — ported from mdx-graphs.kshv.me's `graph-plot.tsx`. The reference fades
 * each cell in on scroll with a per-column stagger delay (`fillDelay`); this design system bans
 * that idle per-item reveal machinery, so cells render straight to their final state and the whole
 * graph gets one `graphMotion.fadeUp` entrance instead. The `progress` prop's reveal-column math is
 * real, state-driven behavior (how much of the series is "live" so far) and is preserved as-is.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphRule } from './frame'
import { clamp01, graphMotion, graphTone, roleTone, trackMarks, type Glyphs, type GraphPalette } from './motion'
import { util } from '../../ui'

type GraphPlotProps = {
  title?: string
  data: number[]
  labels?: string[]
  height?: number
  variant?: 'line' | 'area'
  progress?: number
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 12 },
  row: { display: 'flex', gap: 12 },
  yAxis: {
    display: 'flex',
    width: '4ch',
    flex: 'none',
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingBlock: '0 1px',
    textAlign: 'right',
  },
  plot: { display: 'flex', minWidth: 0, flex: 1, alignItems: 'flex-end', userSelect: 'none' },
  column: { display: 'flex', height: '100%', minWidth: '1ch', flex: 1, flexDirection: 'column', justifyContent: 'flex-end' },
  cell: { height: '1em', width: '100%', textAlign: 'center' },
  hidden: { color: 'transparent' },
  invisibleAxis: { visibility: 'hidden', width: '4ch', flex: 'none' },
  ruleRow: { flex: 1 },
  labelsRow: { display: 'flex', flex: 1, justifyContent: 'space-between' },
})

function formatTick(value: number) {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

export function GraphPlot({
  title,
  data,
  labels,
  height = 7,
  variant = 'area',
  progress = 1,
  glyphs,
  palette,
  corner,
}: GraphPlotProps) {
  const max = Math.max(...data, 0)
  const min = Math.min(0, ...data)
  const range = max - min || 1
  const end = labels?.[labels.length - 1]
  const start = labels?.[0]
  const yLabel = formatTick(max)
  const revealed = Math.round(clamp01(progress) * data.length)
  const lastLive = Math.max(0, revealed - 1)
  const marks = trackMarks(glyphs)
  const heightPx = { height: `${height}em` }

  return (
    <Graph title={title} corner={corner} sx={graphMotion.fadeUp}>
      <GraphBody sx={s.body}>
        <div {...stylex.props(s.row)}>
          <div {...stylex.props(s.yAxis, util.tabular, graphTone.muted)} style={heightPx}>
            <span>{yLabel}</span>
            <span>{formatTick(min)}</span>
          </div>
          <div aria-hidden="true" {...stylex.props(s.plot)} style={heightPx}>
            {data.map((value, column) => {
              const level = Math.round(((value - min) / range) * (height - 1))
              const live = column === lastLive && column < revealed
              const shown = column < revealed

              return (
                <span key={column} {...stylex.props(s.column)}>
                  {Array.from({ length: height }, (_, row) => {
                    const fromBottom = height - 1 - row
                    const isCap = shown && fromBottom === level
                    const isFill = shown && variant === 'area' && fromBottom < level
                    const glyph = isCap ? marks.fill : isFill ? marks.rest : ' '
                    const tone = isCap
                      ? live
                        ? roleTone(palette, 'primary')
                        : graphTone.ink
                      : isFill
                        ? roleTone(palette, 'secondary')
                        : s.hidden

                    return (
                      <span key={row} {...stylex.props(s.cell, tone)}>
                        {glyph}
                      </span>
                    )
                  })}
                </span>
              )
            })}
          </div>
        </div>
        {start || end ? (
          <>
            <div {...stylex.props(s.row)}>
              <span {...stylex.props(s.invisibleAxis, util.tabular)}>{yLabel}</span>
              <GraphRule sx={s.ruleRow} />
            </div>
            <div {...stylex.props(s.row)}>
              <span {...stylex.props(s.invisibleAxis, util.tabular)}>{yLabel}</span>
              <div {...stylex.props(s.labelsRow, graphTone.muted)}>
                <span>{start}</span>
                {end && end !== start ? <span>{end}</span> : null}
              </div>
            </div>
          </>
        ) : null}
        <span {...stylex.props(util.srOnly)}>
          {variant} plot, {data.length} points, min {formatTick(min)}, max {formatTick(max)}
        </span>
      </GraphBody>
    </Graph>
  )
}

export type { GraphPlotProps }
