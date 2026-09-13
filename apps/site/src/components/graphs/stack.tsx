'use client'

/**
 * ASCII stacked-segment bars — ported from mdx-graphs.kshv.me's `graph-stack.tsx`. The reference
 * staggers each row in on scroll via a `motion.ul`/`motion.li` variant list; this design system
 * bans per-item stagger machinery, so rows render in their final state and the whole graph gets one
 * `graphMotion.fadeUp` entrance instead. `paintRow`'s tick-allocation math is preserved as-is.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import {
  graphMotion,
  graphTone,
  isMonoPalette,
  resolveGlyphs,
  seriesDimStyle,
  seriesTone,
  type Glyphs,
  type GraphPalette,
} from './motion'

const DEFAULT_GLYPHS = ['█', '▓', '▒', '░', '#', '=', '+', '-']

type StackSegment = {
  label: string
  value: number
}

type StackRow = {
  label: string
  segments: StackSegment[]
}

type GraphStackProps = {
  title?: string
  rows: StackRow[]
  accent?: string
  ticks?: number
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
}

type Painted = {
  label: string
  glyph: string
  count: number
  accent: boolean
}

function paintRow(
  segments: StackSegment[],
  ticks: number,
  glyphs: readonly string[],
  accentLabel?: string,
): Painted[] {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1
  let left = ticks

  return segments.map((segment, index) => {
    const raw = Math.round((segment.value / total) * ticks)
    const count = index === segments.length - 1 ? Math.max(0, left) : Math.min(Math.max(0, raw), left)
    left -= count
    const highlighted = accentLabel ? segment.label === accentLabel : index === 0

    return {
      label: segment.label,
      glyph: glyphs[index % glyphs.length] ?? '█',
      count,
      accent: highlighted,
    }
  })
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 24 },
  list: { display: 'flex', flexDirection: 'column', gap: 12, margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0,7rem) minmax(0,1fr)',
    alignItems: 'center',
    columnGap: 8,
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  legend: { display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 4, margin: 0, padding: 0, listStyle: 'none' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 8 },
})

export function GraphStack({ title, rows, accent, ticks = 24, glyphs, palette, corner }: GraphStackProps) {
  const set = glyphs == null ? DEFAULT_GLYPHS : resolveGlyphs(glyphs)
  const legend: string[] = []

  for (const row of rows) {
    for (const segment of row.segments) {
      if (!legend.includes(segment.label)) legend.push(segment.label)
    }
  }

  return (
    <Graph title={title} corner={corner} sx={graphMotion.fadeUp}>
      <GraphBody sx={s.body}>
        <ul {...stylex.props(s.list)} role="list">
          {rows.map((row) => {
            const painted = paintRow(row.segments, ticks, set, accent)

            return (
              <li
                key={row.label}
                aria-label={`${row.label}: ${row.segments.map((segment) => `${segment.label} ${segment.value}`).join(', ')}`}
                {...stylex.props(s.row)}
              >
                <span {...stylex.props(s.label, graphTone.ink)}>{row.label}</span>
                <GraphTrack>
                  {painted.flatMap((piece) =>
                    Array.from({ length: piece.count }, (_, index) => (
                      <GraphTick
                        key={`${piece.label}-${index}`}
                        sx={[
                          seriesTone(palette, legend.indexOf(piece.label)),
                          seriesDimStyle(palette, isMonoPalette(palette) ? piece.accent : true),
                        ]}
                      >
                        {piece.glyph}
                      </GraphTick>
                    )),
                  )}
                </GraphTrack>
              </li>
            )
          })}
        </ul>
        <ul {...stylex.props(s.legend)} role="list">
          {legend.map((label, index) => {
            const glyph = set[index % set.length] ?? '█'
            const highlighted = isMonoPalette(palette) ? (accent ? label === accent : index === 0) : true

            return (
              <li key={label} {...stylex.props(s.legendItem, seriesDimStyle(palette, highlighted))}>
                <span aria-hidden="true" {...stylex.props(seriesTone(palette, index))}>
                  {glyph}
                </span>
                <span {...stylex.props(highlighted ? graphTone.ink : graphTone.muted)}>{label}</span>
              </li>
            )
          })}
        </ul>
      </GraphBody>
    </Graph>
  )
}

export type { GraphStackProps, StackRow, StackSegment }
