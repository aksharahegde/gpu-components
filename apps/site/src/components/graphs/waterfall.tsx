'use client'

/**
 * ASCII running-total waterfall — ported from mdx-graphs.kshv.me's `graph-waterfall.tsx`. The
 * reference staggers each row in on scroll via a `motion.ul`/`motion.div` variant list; this design
 * system bans per-item stagger machinery, so rows render in their final state and the whole graph
 * gets one `graphMotion.fadeUp` entrance instead. `resolveKind`/`formatValue`/the running-total
 * segment math are preserved as-is.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphRule, GraphTick, GraphTrack } from './frame'
import { graphMotion, graphTone, roleTone, trackMarks, type Glyphs, type GraphPalette } from './motion'
import { util } from '../../ui'

const SM = '@media (min-width: 640px)'

type WaterfallKind = 'start' | 'in' | 'out' | 'end'

type WaterfallItem = {
  label: string
  value: number
  display?: string
  kind?: WaterfallKind
}

type GraphWaterfallProps = {
  title?: string
  items: WaterfallItem[]
  ticks?: number
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
}

function resolveKind(item: WaterfallItem, index: number, length: number): WaterfallKind {
  if (item.kind) return item.kind
  if (index === 0) return 'start'
  if (index === length - 1) return 'end'
  return item.value >= 0 ? 'in' : 'out'
}

function formatValue(item: WaterfallItem, kind: WaterfallKind) {
  if (item.display) return item.display
  const absolute = Math.abs(item.value)
  if (kind === 'in') return `+${absolute.toLocaleString('en-US')}`
  if (kind === 'out') return `−${absolute.toLocaleString('en-US')}`
  return item.value.toLocaleString('en-US')
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 12 },
  list: { display: 'flex', width: '100%', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
  itemWrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0,7rem) minmax(0,1fr) minmax(0,5.5rem)',
    alignItems: 'center',
    columnGap: { default: 8, [SM]: 16 },
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  value: { textAlign: 'right' },
})

export function GraphWaterfall({ title, items, ticks = 24, glyphs, palette, corner }: GraphWaterfallProps) {
  const marks = trackMarks(glyphs)
  let run = 0
  const segments = items.map((entry, index) => {
    const kind = resolveKind(entry, index, items.length)
    const magnitude = Math.abs(entry.value)

    if (kind === 'start') {
      const from = 0
      const to = entry.value
      run = entry.value
      return { ...entry, kind, from, to }
    }
    if (kind === 'in') {
      const from = run
      const to = run + magnitude
      run = to
      return { ...entry, kind, from, to }
    }
    if (kind === 'out') {
      const to = run
      const from = run - magnitude
      run = from
      return { ...entry, kind, from, to }
    }
    const total = entry.value
    run = total
    return { ...entry, kind, from: 0, to: total }
  })
  const lows = segments.map((segment) => Math.min(segment.from, segment.to))
  const highs = segments.map((segment) => Math.max(segment.from, segment.to))
  const low = Math.min(0, ...lows)
  const high = Math.max(1, ...highs)
  const span = high - low || 1

  function column(value: number) {
    return Math.round(((value - low) / span) * ticks)
  }

  return (
    <Graph title={title} corner={corner} sx={graphMotion.fadeUp}>
      <GraphBody sx={s.body}>
        <ul {...stylex.props(s.list)} role="list">
          {segments.map((segment, index) => {
            const start = Math.min(column(segment.from), column(segment.to))
            const end = Math.max(column(segment.from), column(segment.to), start + 1)
            const isEnd = segment.kind === 'end'
            const showRule = isEnd && index > 0
            const valueTone =
              segment.kind === 'out'
                ? roleTone(palette, 'secondary')
                : segment.kind === 'end'
                  ? roleTone(palette, 'primary')
                  : graphTone.ink

            return (
              <li key={segment.label} {...stylex.props(s.itemWrap)}>
                {showRule ? <GraphRule /> : null}
                <div {...stylex.props(s.row)}>
                  <span {...stylex.props(s.label, graphTone.ink)}>{segment.label}</span>
                  <GraphTrack>
                    {Array.from({ length: ticks }, (_, cell) => {
                      const filled = cell >= start && cell < end
                      const tone = !filled
                        ? roleTone(palette, 'empty')
                        : segment.kind === 'out'
                          ? roleTone(palette, 'secondary')
                          : segment.kind === 'start'
                            ? graphTone.ink
                            : roleTone(palette, 'primary')

                      return (
                        <GraphTick key={cell} sx={tone}>
                          {filled ? marks.fill : marks.empty}
                        </GraphTick>
                      )
                    })}
                  </GraphTrack>
                  <span {...stylex.props(s.value, util.tabular, valueTone)}>{formatValue(segment, segment.kind)}</span>
                </div>
              </li>
            )
          })}
        </ul>
        <span {...stylex.props(util.srOnly)}>
          {segments.map((segment) => `${segment.label} ${formatValue(segment, segment.kind)}`).join(', ')}
        </span>
      </GraphBody>
    </Graph>
  )
}

export type { GraphWaterfallProps, WaterfallItem, WaterfallKind }
