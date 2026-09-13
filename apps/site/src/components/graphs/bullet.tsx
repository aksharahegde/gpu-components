'use client'

/**
 * Ported from mdx-graphs.kshv.me's `graph-bullet.tsx`. The reference staggers each `<li>` in via
 * `motion/react`; this design system bans stagger (see `./motion.ts`), so the whole list gets one
 * static `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import { graphMotion, graphTone, roleTone, trackMarks, type Glyphs, type GraphPalette } from './motion'
import type { SX } from '../../ui'

const SM = '@media (min-width: 640px)'

const s = stylex.create({
  list: { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 7rem) minmax(0, 1fr) minmax(0, 7rem)',
    alignItems: 'center',
    columnGap: { default: 8, [SM]: 16 },
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit' },
  trackWrap: { display: 'flex', minWidth: 0, alignItems: 'center' },
  value: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
})

export type BulletItem = {
  label: string
  value: number
  target?: number
  max?: number
  display?: string
}

export type GraphBulletProps = {
  title?: string
  items: BulletItem[]
  ticks?: number
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

function formatItem(item: BulletItem) {
  if (item.display) return item.display
  const value = item.value.toLocaleString('en-US', {
    maximumFractionDigits: Number.isInteger(item.value) ? 0 : 1,
  })
  if (item.target == null) return value
  const target = item.target.toLocaleString('en-US', {
    maximumFractionDigits: Number.isInteger(item.target) ? 0 : 1,
  })
  return `${value} / ${target}`
}

export function GraphBullet({ title, items, ticks = 20, glyphs, palette, corner, sx }: GraphBulletProps) {
  const marks = trackMarks(glyphs, { empty: '-', rest: '=', fill: '=' })

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody>
        <ul {...stylex.props(s.list, graphMotion.fadeUp)} role="list">
          {items.map((entry) => {
            const peak = entry.max ?? Math.max(entry.value, entry.target ?? 0, 1)
            const filled = Math.min(ticks, Math.round((Math.max(entry.value, 0) / peak) * ticks))
            const mark =
              entry.target == null
                ? null
                : Math.min(ticks - 1, Math.max(0, Math.round((Math.max(entry.target, 0) / peak) * ticks)))

            return (
              <li key={entry.label} aria-label={`${entry.label} ${formatItem(entry)}`} {...stylex.props(s.row)}>
                <span {...stylex.props(s.label, graphTone.ink)}>{entry.label}</span>
                <span {...stylex.props(s.trackWrap)}>
                  <span aria-hidden="true" {...stylex.props(graphTone.frame)}>
                    [
                  </span>
                  <GraphTrack>
                    {Array.from({ length: ticks }, (_, index) => {
                      const isMark = mark != null && index === mark
                      const isFill = index < filled
                      const tone = isMark
                        ? roleTone(palette, 'secondary')
                        : isFill
                          ? mark != null && index > mark
                            ? roleTone(palette, 'secondary')
                            : roleTone(palette, 'primary')
                          : graphTone.frame

                      return (
                        <GraphTick key={index} sx={tone}>
                          {isMark ? '|' : isFill ? marks.fill : marks.empty}
                        </GraphTick>
                      )
                    })}
                  </GraphTrack>
                  <span aria-hidden="true" {...stylex.props(graphTone.frame)}>
                    ]
                  </span>
                </span>
                <span {...stylex.props(s.value, graphTone.muted)}>{formatItem(entry)}</span>
              </li>
            )
          })}
        </ul>
      </GraphBody>
    </Graph>
  )
}
