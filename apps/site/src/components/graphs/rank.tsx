'use client'

/** Ported from mdx-graphs.kshv.me's `graph-rank.tsx` — a bracketed ASCII bar-track ranking list.
 * Framer Motion's `staggerList`/`fadeUp` become a static `graphMotion.fadeUp` per row. */

import * as stylex from '@stylexjs/stylex'
import { color } from '../../tokens.stylex'
import type { SX } from '../../ui'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import { graphMotion, graphTone, roleTone, trackMarks, type GraphPalette, type Glyphs } from './motion'

const SM = '@media (min-width: 640px)'

export type RankItem = {
  label: string
  value: number
  display?: string
}

export type GraphRankProps = {
  title?: string
  items: RankItem[]
  max?: number
  ticks?: number
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 12 },
  list: { display: 'flex', width: '100%', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 7rem) minmax(0, 1fr) minmax(0, 7rem)',
    alignItems: 'center',
    columnGap: { default: 8, [SM]: 16 },
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: color.text },
  trackWrap: { display: 'flex', minWidth: 0, alignItems: 'center' },
  bracket: { userSelect: 'none' },
  value: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
})

function formatValue(item: RankItem) {
  if (item.display) return item.display
  return item.value.toLocaleString('en-US', {
    maximumFractionDigits: Number.isInteger(item.value) ? 0 : 1,
  })
}

export function GraphRank({ title, items, max, ticks = 20, glyphs, palette, corner, sx }: GraphRankProps) {
  const peak = max ?? Math.max(...items.map((entry) => entry.value), 1)
  const marks = trackMarks(glyphs, { empty: '-', rest: '=', fill: '=' })

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.body}>
        <ol {...stylex.props(s.list)}>
          {items.map((entry) => {
            const filled = Math.min(ticks, Math.round((Math.max(entry.value, 0) / peak) * ticks))
            const shown = formatValue(entry)

            return (
              <li
                key={entry.label}
                aria-label={`${entry.label} ${shown}`}
                {...stylex.props(s.row, graphMotion.fadeUp)}
              >
                <span {...stylex.props(s.label)}>{entry.label}</span>
                <span {...stylex.props(s.trackWrap)}>
                  <span aria-hidden="true" {...stylex.props(s.bracket, graphTone.frame)}>
                    [
                  </span>
                  <GraphTrack>
                    {Array.from({ length: ticks }, (_, index) => {
                      const on = index < filled
                      return (
                        <GraphTick key={index} sx={on ? roleTone(palette, 'primary') : graphTone.frame}>
                          {on ? marks.fill : marks.empty}
                        </GraphTick>
                      )
                    })}
                  </GraphTrack>
                  <span aria-hidden="true" {...stylex.props(s.bracket, graphTone.frame)}>
                    ]
                  </span>
                </span>
                <span {...stylex.props(s.value, graphTone.muted)}>{shown}</span>
              </li>
            )
          })}
        </ol>
      </GraphBody>
    </Graph>
  )
}
