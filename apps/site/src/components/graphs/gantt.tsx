'use client'

/** Ported from mdx-graphs.kshv.me's `graph-gantt.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp`
 * per row (same convention as `table.tsx`), and `seriesDim`'s inline style becomes the
 * `graphFx.dim` StyleX style applied via `sx`. */

import * as stylex from '@stylexjs/stylex'
import type { SX } from '../../ui'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import {
  clamp01,
  graphMotion,
  graphTone,
  roleTone,
  seriesDimStyle,
  trackMarks,
  type Glyphs,
  type GraphPalette,
} from './motion'

const SM = '@media (min-width: 640px)'

type GanttItem = {
  label: string
  start: number
  end: number
  accent?: boolean
  complete?: number
}

export type GraphGanttProps = {
  title?: string
  items: GanttItem[]
  ticks?: string[]
  columns?: number
  stage?: string
  progress?: number
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 16 },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 112px) minmax(0, 1fr)',
    columnGap: { default: 8, [SM]: 16 },
    alignItems: 'center',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  transparent: { color: 'transparent' },
  ticksRow: { display: 'flex', justifyContent: 'space-between' },
})

export function GraphGantt({
  title,
  items,
  ticks,
  columns = 24,
  stage,
  progress,
  glyphs,
  palette,
  corner,
  sx,
}: GraphGanttProps) {
  const playhead = progress == null ? null : Math.round(clamp01(progress) * (columns - 1))
  const marks = trackMarks(glyphs)

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.body}>
        {playhead != null ? (
          <div {...stylex.props(s.row)}>
            <span />
            <GraphTrack>
              {Array.from({ length: columns }, (_, index) => (
                <GraphTick key={index} sx={index === playhead ? roleTone(palette, 'primary') : s.transparent}>
                  ▾
                </GraphTick>
              ))}
            </GraphTrack>
          </div>
        ) : null}
        <ul role="list" {...stylex.props(s.list)}>
          {items.map((entry) => {
            const start = Math.round(clamp01(entry.start) * columns)
            const end = Math.max(start + 1, Math.round(clamp01(entry.end) * columns))
            const span = end - start
            const done = Math.round(clamp01(entry.complete ?? 1) * span)
            const focused = stage ? entry.label === stage : Boolean(entry.accent)
            const dim = Boolean(stage) && !focused

            return (
              <li
                key={entry.label}
                aria-label={`${entry.label} from ${Math.round(entry.start * 100)}% to ${Math.round(entry.end * 100)}%${
                  entry.complete != null ? `, ${Math.round(entry.complete * 100)}% complete` : ''
                }`}
                {...stylex.props(s.row, graphMotion.fadeUp, seriesDimStyle(palette, !dim))}
              >
                <span {...stylex.props(s.label, focused ? roleTone(palette, 'primary') : graphTone.ink)}>
                  {entry.label}
                </span>
                <GraphTrack>
                  {Array.from({ length: columns }, (_, index) => {
                    const inBar = index >= start && index < end
                    const filled = inBar && index < start + done
                    const rest = inBar && !filled

                    return (
                      <GraphTick
                        key={index}
                        sx={
                          filled
                            ? focused
                              ? roleTone(palette, 'primary')
                              : graphTone.ink
                            : rest
                              ? roleTone(palette, 'secondary')
                              : roleTone(palette, 'empty')
                        }
                      >
                        {filled ? marks.fill : rest ? marks.rest : marks.empty}
                      </GraphTick>
                    )
                  })}
                </GraphTrack>
              </li>
            )
          })}
        </ul>
        {ticks && ticks.length > 0 ? (
          <div {...stylex.props(s.row)}>
            <span />
            <div {...stylex.props(s.ticksRow, graphTone.muted)}>
              {ticks.map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
          </div>
        ) : null}
      </GraphBody>
    </Graph>
  )
}

export type { GanttItem }
