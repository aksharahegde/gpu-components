'use client'

/** Ported from mdx-graphs.kshv.me's `graph-timeline.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp`
 * per row, same convention as `table.tsx` (no stagger, no `useReducedMotion` check needed). */

import * as stylex from '@stylexjs/stylex'
import type { SX } from '../../ui'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone, roleTone, type GraphPalette } from './motion'

type TimelineState = 'done' | 'now' | 'next'

type TimelineEvent = {
  date: string
  label: string
  state?: TimelineState
}

export type GraphTimelineProps = {
  title?: string
  events: TimelineEvent[]
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

const mark: Record<TimelineState, string> = {
  done: '●',
  now: '●',
  next: '○',
}

const s = stylex.create({
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: '20px 112px minmax(0, 1fr)',
    columnGap: 16,
    alignItems: 'baseline',
  },
  connector: {
    display: 'grid',
    gridTemplateColumns: '20px 112px minmax(0, 1fr)',
    columnGap: 16,
    paddingBlock: 4,
    userSelect: 'none',
  },
  markCell: { textAlign: 'center', lineHeight: 1, userSelect: 'none' },
  tabular: { fontVariantNumeric: 'tabular-nums' },
})

function toneFor(state: TimelineState, live: boolean, palette: GraphPalette | undefined) {
  if (live) return roleTone(palette, 'primary')
  if (state === 'done') return graphTone.ink
  return roleTone(palette, 'secondary')
}

export function GraphTimeline({ title, events, palette, corner, sx }: GraphTimelineProps) {
  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody>
        <ol role="list" {...stylex.props(s.list)}>
          {events.map((event, index) => {
            const state = event.state ?? 'done'
            const last = index === events.length - 1
            const live = state === 'now'
            const tone = toneFor(state, live, palette)

            return (
              <li key={`${event.date}-${event.label}`} {...stylex.props(graphMotion.fadeUp)}>
                <div {...stylex.props(s.row)}>
                  <span aria-hidden="true" {...stylex.props(s.markCell, tone)}>
                    {mark[state]}
                  </span>
                  <span {...stylex.props(s.tabular, state === 'next' ? roleTone(palette, 'secondary') : graphTone.ink)}>
                    {event.date}
                  </span>
                  <span {...stylex.props(tone)}>{event.label}</span>
                </div>
                {last ? null : (
                  <div aria-hidden="true" {...stylex.props(s.connector)}>
                    <span {...stylex.props(s.markCell, graphTone.frame)}>│</span>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </GraphBody>
    </Graph>
  )
}
