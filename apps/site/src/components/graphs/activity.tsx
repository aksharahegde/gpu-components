'use client'

/** Ported from mdx-graphs.kshv.me's `graph-activity.tsx` onto StyleX + the shared `Graph` frame —
 * date/grid math is ported verbatim (pure logic, nothing to adapt). Framer Motion's
 * `staggerList`/`fadeUp` variants become a static `graphMotion.fadeUp` per week column (same
 * convention as `table.tsx`, no stagger). The reference's dynamic `minWidth: max(100%, Nch)` trick
 * (computed from `weeks.length`) is dropped — StyleX under this site's CSP can't express a
 * runtime-computed inline style (see `ui.tsx`'s `gaps` comment), and the flex layout already
 * scrolls correctly without it. */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DAY_MS = 86_400_000

type ActivityDay = {
  date: string
  count: number
}

type ActivityCell = {
  date: string
  count: number
  inRange: boolean
}

export type GraphActivityProps = {
  title?: string
  days: ActivityDay[]
  weekStartsOn?: 0 | 1
  max?: number
  legend?: boolean
  caption?: string | false
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

function parseUTC(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function toISO(utc: number) {
  return new Date(utc).toISOString().slice(0, 10)
}

function buildWeeks(days: ActivityDay[], weekStartsOn: 0 | 1) {
  if (days.length === 0) {
    return [] as ActivityCell[][]
  }

  const counts = new Map<string, number>()
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const day of days) {
    const time = parseUTC(day.date)
    counts.set(day.date, day.count)
    if (time < min) min = time
    if (time > max) max = time
  }

  const lead = (new Date(min).getUTCDay() - weekStartsOn + 7) % 7
  const trail = (weekStartsOn + 6 - new Date(max).getUTCDay() + 7) % 7
  const first = min - lead * DAY_MS
  const last = max + trail * DAY_MS
  const weeks: ActivityCell[][] = []
  let week: ActivityCell[] = []

  for (let time = first; time <= last; time += DAY_MS) {
    const date = toISO(time)
    const inRange = time >= min && time <= max
    week.push({
      date,
      count: inRange ? (counts.get(date) ?? 0) : 0,
      inRange,
    })
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }

  return weeks
}

function monthLabels(weeks: ActivityCell[][]) {
  return weeks.map((week) => {
    const start = week.find((cell) => {
      if (!cell.inRange) {
        return false
      }

      return new Date(parseUTC(cell.date)).getUTCDate() === 1
    })

    if (!start) {
      return ''
    }

    return MONTHS[new Date(parseUTC(start.date)).getUTCMonth()] ?? ''
  })
}

function dayLabels(weekStartsOn: 0 | 1) {
  return weekStartsOn === 1 ? ['M', '', 'W', '', 'F', '', ''] : ['', 'M', '', 'W', '', 'F', '']
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 16 },
  scrollX: { overflowX: 'auto' },
  chart: { display: 'flex', width: '100%', flexDirection: 'column', gap: 4, paddingInlineEnd: '2ch' },
  monthsRow: { display: 'flex', height: '1.25em', width: '100%' },
  monthsGutter: { width: '2ch', flexShrink: 0 },
  monthCell: { position: 'relative', minWidth: '1ch', flex: 1 },
  monthLabel: { position: 'absolute', insetBlockEnd: 0, insetInlineStart: 0, whiteSpace: 'nowrap' },
  gridRow: { display: 'flex', width: '100%' },
  dayGutter: { display: 'flex', width: '2ch', flexShrink: 0, flexDirection: 'column' },
  dayLabel: { display: 'flex', height: '1.15em', alignItems: 'center' },
  weeks: { display: 'flex', flex: 1 },
  week: { display: 'flex', minWidth: '1ch', flex: 1, flexDirection: 'column' },
  cell: {
    display: 'flex',
    height: '1.15em',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    userSelect: 'none',
  },
  transparent: { color: 'transparent' },
  footer: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  footerEnd: { justifyContent: 'flex-end' },
  scaleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  scaleGlyphs: { display: 'flex', userSelect: 'none' },
  scaleGlyph: { width: '1ch', textAlign: 'center' },
})

function IntensityScale({ glyphs, palette }: { glyphs: readonly string[]; palette?: GraphPalette }) {
  return (
    <p {...stylex.props(s.scaleRow, graphTone.muted)}>
      <span>Less</span>
      <span aria-hidden="true" {...stylex.props(s.scaleGlyphs)}>
        {glyphs.map((glyph, index) => (
          <span
            key={`${glyph}-${index}`}
            {...stylex.props(
              s.scaleGlyph,
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

export function GraphActivity({
  title,
  days,
  weekStartsOn = 0,
  max,
  legend = true,
  caption,
  glyphs,
  palette,
  corner,
  sx,
}: GraphActivityProps) {
  const weeks = buildWeeks(days, weekStartsOn)
  const months = monthLabels(weeks)
  const labels = dayLabels(weekStartsOn)
  const peak = max ?? Math.max(0, ...days.map((day) => day.count), 0)
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const summary = `${total.toLocaleString('en-US')} contributions`
  const set = resolveGlyphs(glyphs)
  const quiet = set[0] ?? '·'

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.body}>
        <div {...stylex.props(s.scrollX)}>
          <div {...stylex.props(s.chart)}>
            <div {...stylex.props(s.monthsRow)}>
              <span {...stylex.props(s.monthsGutter)} />
              {months.map((month, index) => (
                <span key={`m-${index}`} {...stylex.props(s.monthCell)}>
                  {month ? (
                    <span {...stylex.props(s.monthLabel, graphTone.muted)}>{month}</span>
                  ) : null}
                </span>
              ))}
            </div>
            <div {...stylex.props(s.gridRow)}>
              <div {...stylex.props(s.dayGutter)}>
                {labels.map((label, index) => (
                  <span key={`d-${index}`} {...stylex.props(s.dayLabel, graphTone.muted)}>
                    {label}
                  </span>
                ))}
              </div>
              <div {...stylex.props(s.weeks)}>
                {weeks.map((week, weekIndex) => (
                  <div key={week[0]?.date ?? weekIndex} {...stylex.props(s.week, graphMotion.fadeUp)}>
                    {week.map((cell) => {
                      const level = cell.inRange ? intensityLevel(cell.count, peak) : 0

                      return (
                        <span
                          key={cell.date}
                          aria-hidden="true"
                          {...stylex.props(s.cell, cell.inRange ? intensityTone(level, palette) : s.transparent)}
                        >
                          {cell.inRange ? intensityGlyph(level, set) : quiet}
                        </span>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {caption === false && !legend ? null : (
          <div {...stylex.props(s.footer, caption === false && s.footerEnd)}>
            {caption === false ? null : (
              <p {...stylex.props(graphTone.muted, util.tabular)}>{caption ?? summary}</p>
            )}
            {legend ? <IntensityScale glyphs={set} palette={palette} /> : null}
          </div>
        )}
        <span {...stylex.props(util.srOnly)}>
          {total} contributions across {days.length} days
          {caption ? `. ${caption}` : ''}
        </span>
      </GraphBody>
    </Graph>
  )
}

export type { ActivityDay }
