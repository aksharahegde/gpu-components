'use client'

/**
 * Ported from mdx-graphs.kshv.me's `graph-kpi.tsx`. The reference drives the value/label block and
 * the sparkline ticks with `motion/react` `whileInView` + a staggered per-tick delay; this design
 * system bans idle/looping motion and stagger entirely (see `./motion.ts`), so the whole card gets a
 * single static `graphMotion.fadeUp` entrance instead — no per-glyph delay ladder.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import {
  graphFx,
  graphMotion,
  isMonoPalette,
  resolveGlyphs,
  roleTone,
  type Glyphs,
  type GraphPalette,
} from './motion'
import type { SX } from '../../ui'
import { util } from '../../ui'

const SPARK_DEFAULT = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

const SM = '@media (min-width: 640px)'

const s = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 16 },
  valueRow: { display: 'flex', flexDirection: 'column', gap: 8 },
  value: {
    fontSize: { default: 30, [SM]: 36 },
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    margin: 0,
  },
  metaRow: { display: 'flex', alignItems: 'baseline', gap: 12 },
  meta: { margin: 0 },
  track: { justifyContent: 'flex-start', gap: 2 },
  tick: { flex: 'none' },
})

export type GraphKpiProps = {
  title?: string
  value: string
  label: string
  hint?: string
  data: number[]
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
  sx?: SX
}

export function GraphKpi({ title, value, label, hint, data, glyphs, palette, corner, sx }: GraphKpiProps) {
  const max = Math.max(...data, 1)
  const last = data.length - 1
  const set = glyphs == null ? SPARK_DEFAULT : resolveGlyphs(glyphs)
  const points = data.map((entry) => {
    const index = Math.round((entry / max) * (set.length - 1))
    return set[index] ?? set[0] ?? '▁'
  })
  const mono = isMonoPalette(palette)

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.stack}>
        <div {...stylex.props(s.valueRow, graphMotion.fadeUp)}>
          <p {...stylex.props(s.value, roleTone(palette, 'primary'))}>{value}</p>
          <div {...stylex.props(s.metaRow)}>
            <p {...stylex.props(s.meta, roleTone(palette, 'idle'))}>{label}</p>
            {hint ? <p {...stylex.props(s.meta, roleTone(palette, 'idle'), util.tabular)}>{hint}</p> : null}
          </div>
        </div>
        {points.length > 0 ? (
          <GraphTrack sx={s.track}>
            {points.map((glyph, index) => {
              const live = index === last
              const dim = !live && mono
              return (
                <GraphTick key={`${glyph}-${index}`} sx={s.tick}>
                  <span
                    {...stylex.props(
                      live ? roleTone(palette, 'primary') : roleTone(palette, 'secondary'),
                      dim && graphFx.dim,
                    )}
                  >
                    {glyph}
                  </span>
                </GraphTick>
              )
            })}
          </GraphTrack>
        ) : null}
        <span {...stylex.props(util.srOnly)}>
          {value} {label}
          {hint ? `. ${hint}` : ''}
        </span>
      </GraphBody>
    </Graph>
  )
}
