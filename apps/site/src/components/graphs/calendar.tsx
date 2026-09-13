'use client'

/** Ported from mdx-graphs.kshv.me's `graph-calendar.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp`
 * per week row (same convention as `table.tsx`, no stagger). */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
import { Graph, GraphBody } from './frame'
import { graphMotion, graphTone, isMonoPalette, roleTone, type GraphPalette } from './motion'

const WEEKDAYS_SUN = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAYS_MON = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

type CalendarMark = {
  day: number
  accent?: boolean
}

export type GraphCalendarProps = {
  title?: string
  year: number
  month: number
  weekStartsOn?: 0 | 1
  marks?: CalendarMark[] | number[]
  today?: number
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

function monthLength(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function leadingBlanks(year: number, monthIndex: number, weekStartsOn: 0 | 1) {
  const weekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay()
  return (weekday - weekStartsOn + 7) % 7
}

function markSet(marks: GraphCalendarProps['marks']) {
  const map = new Map<number, boolean>()

  if (!marks) {
    return map
  }

  for (const mark of marks) {
    if (typeof mark === 'number') {
      map.set(mark, true)
      continue
    }

    map.set(mark.day, mark.accent ?? true)
  }

  return map
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 12 },
  headerRow: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', justifyItems: 'center' },
  headerCell: { width: '4ch', textAlign: 'center' },
  weeks: { display: 'flex', flexDirection: 'column', gap: 4 },
  week: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', justifyItems: 'center' },
  day: { width: '4ch', textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
  transparent: { color: 'transparent' },
})

export function GraphCalendar({
  title,
  year,
  month,
  weekStartsOn = 1,
  marks,
  today,
  palette,
  corner,
  sx,
}: GraphCalendarProps) {
  const monthIndex = month - 1
  const days = monthLength(year, monthIndex)
  const pad = leadingBlanks(year, monthIndex, weekStartsOn)
  const highlighted = markSet(marks)
  const headers = weekStartsOn === 1 ? WEEKDAYS_MON : WEEKDAYS_SUN
  const trailing = (7 - ((pad + days) % 7)) % 7
  const caption = title ?? `${MONTHS[monthIndex]} ${year}`
  const grid: (number | null)[] = [
    ...Array.from({ length: pad }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1),
    ...Array.from({ length: trailing }, () => null),
  ]
  const weeks: (number | null)[][] = []

  for (let index = 0; index < grid.length; index += 7) {
    weeks.push(grid.slice(index, index + 7))
  }

  return (
    <Graph title={caption} corner={corner} sx={sx}>
      <GraphBody sx={s.body}>
        <div aria-hidden="true" {...stylex.props(s.headerRow)}>
          {headers.map((header, index) => (
            <span key={`${header}-${index}`} {...stylex.props(s.headerCell, graphTone.muted)}>
              {header}
            </span>
          ))}
        </div>
        <div aria-hidden="true" {...stylex.props(s.weeks)}>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} {...stylex.props(s.week, graphMotion.fadeUp)}>
              {week.map((day, dayIndex) => {
                const inMonth = day != null
                const accent = inMonth && highlighted.get(day) === true
                const isToday = inMonth && today === day

                const tone = !inMonth
                  ? s.transparent
                  : accent
                    ? roleTone(palette, 'primary')
                    : isToday
                      ? roleTone(palette, isMonoPalette(palette) ? 'primary' : 'secondary')
                      : graphTone.ink

                return (
                  <span key={`${weekIndex}-${dayIndex}`} {...stylex.props(s.day, tone)}>
                    {inMonth ? (isToday ? `[${day}]` : day) : ' '}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
        <span {...stylex.props(util.srOnly)}>
          {MONTHS[monthIndex]} {year}
          {today ? `, today ${today}` : ''}
          {highlighted.size > 0 ? `, marked ${[...highlighted.keys()].join(', ')}` : ''}
        </span>
      </GraphBody>
    </Graph>
  )
}

export type { CalendarMark }
