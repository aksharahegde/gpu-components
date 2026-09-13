'use client'

/** Ported from mdx-graphs.kshv.me's `graph-uptime.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp`
 * per row (same convention as `table.tsx`, no stagger). */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import { graphMotion, graphTone, resolveGlyphs, roleTone, type Glyphs, type GraphPalette } from './motion'

type UptimeStatus = 'ok' | 'degraded' | 'down' | 'empty'

export type GraphUptimeProps = {
  title?: string
  days: UptimeStatus[]
  from?: string
  to?: string
  columns?: number
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

function statusTone(palette: GraphPalette | undefined): Record<UptimeStatus, ReturnType<typeof roleTone>> {
  return {
    ok: roleTone(palette, 'primary'),
    degraded: roleTone(palette, 'secondary'),
    down: roleTone(palette, 'empty'),
    empty: roleTone(palette, 'empty'),
  }
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
  scrollWrap: { display: 'flex', width: 'fit-content', maxWidth: '100%', flexDirection: 'column', gap: 16, overflowX: 'auto' },
  rows: { display: 'flex', flexDirection: 'column', gap: 4, userSelect: 'none' },
  track: { width: 'auto', justifyContent: 'flex-start', gap: 2 },
  tick: { flex: 'none' },
  summaryRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  fromTo: { display: 'flex', gap: 12 },
  legend: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, rowGap: 4 },
})

export function GraphUptime({
  title,
  days,
  from,
  to,
  columns = 30,
  glyphs,
  palette,
  corner,
  sx,
}: GraphUptimeProps) {
  const known = days.filter((day) => day !== 'empty')
  const ok = known.filter((day) => day === 'ok').length
  const percent = known.length === 0 ? 0 : Math.round((ok / known.length) * 100)
  const cols = Math.max(1, columns)
  const rows: UptimeStatus[][] = []
  const set = resolveGlyphs(glyphs)
  const last = set.length - 1
  const mark: Record<UptimeStatus, string> = {
    ok: set[last] ?? '█',
    degraded: set[Math.min(2, last)] ?? '▒',
    down: set[0] ?? '·',
    empty: '-',
  }
  const tone = statusTone(palette)

  for (let index = 0; index < days.length; index += cols) {
    rows.push(days.slice(index, index + cols))
  }

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.body}>
        <div {...stylex.props(s.scrollWrap)}>
          <div aria-hidden="true" {...stylex.props(s.rows)}>
            {rows.map((row, rowIndex) => (
              <div key={rowIndex} {...stylex.props(graphMotion.fadeUp)}>
                <GraphTrack sx={s.track}>
                  {row.map((day, index) => (
                    <GraphTick key={`${rowIndex}-${index}`} sx={[s.tick, tone[day]]}>
                      {mark[day]}
                    </GraphTick>
                  ))}
                </GraphTrack>
              </div>
            ))}
          </div>
          <div {...stylex.props(s.summaryRow)}>
            <p {...stylex.props(util.tabular, tone.ok)}>{percent}%</p>
            {from || to ? (
              <p {...stylex.props(s.fromTo, graphTone.muted)}>
                {from ? <span>{from}</span> : null}
                {to ? <span>{to}</span> : null}
              </p>
            ) : null}
          </div>
        </div>
        <p {...stylex.props(s.legend, graphTone.muted)}>
          <span>
            <span {...stylex.props(tone.ok)}>{mark.ok}</span> up
          </span>
          <span>
            <span {...stylex.props(tone.degraded)}>{mark.degraded}</span> slow
          </span>
          <span>
            <span {...stylex.props(tone.down)}>{mark.down}</span> down
          </span>
        </p>
        <span {...stylex.props(util.srOnly)}>
          {percent} percent uptime over {known.length} days
          {from && to ? `, ${from} to ${to}` : ''}
        </span>
      </GraphBody>
    </Graph>
  )
}

export type { UptimeStatus }
