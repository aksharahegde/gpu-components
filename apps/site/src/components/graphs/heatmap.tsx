'use client'

/**
 * ASCII intensity heatmap — ported from mdx-graphs.kshv.me's `graph-heatmap.tsx`. The reference
 * staggers each row in on scroll via a `motion.ul`/`motion.li` variant list; this design system
 * bans per-item stagger machinery, so rows render in their final state and the whole graph gets one
 * `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody } from './frame'
import {
  graphMotion,
  graphTone,
  intensityGlyph,
  intensityLevel,
  intensityTone,
  resolveGlyphs,
  type Glyphs,
  type GraphPalette,
} from './motion'

type HeatRow = {
  label: string
  values: number[]
}

type GraphHeatmapProps = {
  title?: string
  columns: string[]
  rows: HeatRow[]
  max?: number
  legend?: boolean
  caption?: string
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 16 },
  wrap: { display: 'flex', width: '100%', flexDirection: 'column', gap: 8 },
  headRow: { display: 'grid', width: '100%', alignItems: 'end', columnGap: 4 },
  headLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' },
  list: { display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyle: 'none' },
  row: { display: 'grid', alignItems: 'center', columnGap: 4 },
  rowLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cell: { textAlign: 'center', lineHeight: 1, userSelect: 'none' },
  footer: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  scale: { display: 'flex', alignItems: 'center', gap: 8 },
  scaleGlyphs: { display: 'flex', userSelect: 'none' },
  scaleCell: { width: '1ch', textAlign: 'center' },
})

function IntensityScale({ glyphs, palette }: { glyphs: readonly string[]; palette?: GraphPalette }) {
  return (
    <p {...stylex.props(s.scale, graphTone.muted)}>
      <span>Less</span>
      <span aria-hidden="true" {...stylex.props(s.scaleGlyphs)}>
        {glyphs.map((glyph, index) => (
          <span
            key={`${glyph}-${index}`}
            {...stylex.props(
              s.scaleCell,
              intensityTone(Math.round((index / Math.max(glyphs.length - 1, 1)) * 4), palette),
            )}
          >
            {glyph}
          </span>
        ))}
      </span>
      <span>More</span>
    </p>
  )
}

export function GraphHeatmap({
  title,
  columns,
  rows,
  max,
  legend = true,
  caption,
  glyphs,
  palette,
  corner,
}: GraphHeatmapProps) {
  const peak = max ?? Math.max(0, ...rows.flatMap((row) => row.values), 0)
  const template = `minmax(0,7rem) repeat(${Math.max(columns.length, 1)}, minmax(0,1fr))`
  const set = resolveGlyphs(glyphs)

  return (
    <Graph title={title} corner={corner} sx={graphMotion.fadeUp}>
      <GraphBody sx={s.body}>
        <div {...stylex.props(s.wrap)}>
          <div {...stylex.props(s.headRow)} style={{ gridTemplateColumns: template }}>
            <span />
            {columns.map((column) => (
              <span key={column} {...stylex.props(s.headLabel, graphTone.muted)}>
                {column}
              </span>
            ))}
          </div>
          <ul {...stylex.props(s.list)} role="list">
            {rows.map((row) => (
              <li
                key={row.label}
                aria-label={`${row.label}: ${columns.map((column, index) => `${column} ${row.values[index] ?? 0}`).join(', ')}`}
                {...stylex.props(s.row)}
                style={{ gridTemplateColumns: template }}
              >
                <span {...stylex.props(s.rowLabel, graphTone.ink)}>{row.label}</span>
                {columns.map((column, index) => {
                  const value = row.values[index] ?? 0
                  const level = intensityLevel(value, peak)

                  return (
                    <span
                      key={`${row.label}-${column}`}
                      aria-hidden="true"
                      {...stylex.props(s.cell, intensityTone(level, palette))}
                    >
                      {intensityGlyph(level, set)}
                    </span>
                  )
                })}
              </li>
            ))}
          </ul>
        </div>
        {legend || caption ? (
          <div {...stylex.props(s.footer)}>
            {caption ? <p {...stylex.props(graphTone.muted)}>{caption}</p> : <span />}
            {legend ? <IntensityScale glyphs={set} palette={palette} /> : null}
          </div>
        ) : null}
      </GraphBody>
    </Graph>
  )
}

export type { GraphHeatmapProps, HeatRow }
