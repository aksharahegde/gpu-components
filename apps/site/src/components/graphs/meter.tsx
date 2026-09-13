'use client'

/**
 * Ported from mdx-graphs.kshv.me's `graph-meter.tsx`. The reference reveals each filled tick with a
 * `motion/react` `whileInView` fade and a per-tick delay ladder; this design system bans stagger
 * (see `./motion.ts`), so the whole meter gets one static `graphMotion.fadeUp` entrance and the
 * ticks render immediately at their resolved fill state.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import { graphMotion, graphTone, roleTone, trackMarks, type Glyphs, type GraphPalette } from './motion'
import type { SX } from '../../ui'
import { util } from '../../ui'

const s = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 16 },
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    fontVariantNumeric: 'tabular-nums',
    margin: 0,
  },
  bracket: { userSelect: 'none' },
  pct: { width: '4ch', flex: 'none', textAlign: 'right' },
  caption: { margin: 0 },
})

export type GraphMeterProps = {
  title?: string
  value: number
  ticks?: number
  caption?: string
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

export function GraphMeter({ title, value, ticks = 14, caption, glyphs, palette, corner, sx }: GraphMeterProps) {
  const clamped = Math.min(1, Math.max(0, value))
  const filled = Math.round(clamped * ticks)
  const marks = trackMarks(glyphs, { empty: '-', rest: '=', fill: '=' })

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.stack}>
        <p {...stylex.props(s.row, graphMotion.fadeUp)}>
          <span aria-hidden="true" {...stylex.props(graphTone.frame, s.bracket)}>
            [
          </span>
          <GraphTrack>
            {Array.from({ length: ticks }, (_, index) => {
              const isFilled = index < filled
              return (
                <GraphTick key={index} sx={isFilled ? roleTone(palette, 'primary') : graphTone.frame}>
                  {isFilled ? marks.fill : marks.empty}
                </GraphTick>
              )
            })}
          </GraphTrack>
          <span aria-hidden="true" {...stylex.props(graphTone.frame, s.bracket)}>
            ]
          </span>
          <span {...stylex.props(s.pct, roleTone(palette, 'primary'))}>{Math.round(clamped * 100)}%</span>
        </p>
        {caption ? <p {...stylex.props(s.caption, graphTone.muted)}>{caption}</p> : null}
        <span {...stylex.props(util.srOnly)}>
          {Math.round(clamped * 100)} percent
          {caption ? ` ${caption}` : ''}
        </span>
      </GraphBody>
    </Graph>
  )
}
