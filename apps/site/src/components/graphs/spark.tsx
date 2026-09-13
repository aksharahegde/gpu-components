'use client'

/**
 * ASCII sparkline — ported from mdx-graphs.kshv.me's `graph-spark.tsx`. The reference fades each
 * point in on scroll with a per-point stagger delay; this design system bans that idle per-item
 * reveal machinery, so points render in their final state and the whole graph gets one
 * `graphMotion.fadeUp` entrance instead.
 */

import * as stylex from '@stylexjs/stylex'
import { Graph, GraphBody, GraphTick, GraphTrack } from './frame'
import { graphFx, graphMotion, isMonoPalette, resolveGlyphs, roleTone, type Glyphs, type GraphPalette } from './motion'
import { util } from '../../ui'

const SPARK_DEFAULT = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

type GraphSparkProps = {
  title?: string
  data: number[]
  caption?: string
  glyphs?: Glyphs
  palette?: GraphPalette
  corner?: string
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
  track: { justifyContent: 'center', gap: 2 },
  tick: { flex: 'none' },
})

export function GraphSpark({ title, data, caption, glyphs, palette, corner }: GraphSparkProps) {
  const max = Math.max(...data, 1)
  const last = data.length - 1
  const set = glyphs == null ? SPARK_DEFAULT : resolveGlyphs(glyphs)
  const points = data.map((value) => {
    const index = Math.round((value / max) * (set.length - 1))
    return set[index] ?? set[0] ?? '▁'
  })

  return (
    <Graph title={title} corner={corner} sx={graphMotion.fadeUp}>
      <GraphBody sx={s.body}>
        <GraphTrack sx={s.track}>
          {points.map((glyph, index) => {
            const live = index === last
            const tone = live ? roleTone(palette, 'primary') : roleTone(palette, 'secondary')
            const dim = !live && isMonoPalette(palette) ? graphFx.dim : undefined

            return (
              <GraphTick key={`${glyph}-${index}`} sx={s.tick}>
                <span {...stylex.props(tone, dim)}>{glyph}</span>
              </GraphTick>
            )
          })}
        </GraphTrack>
        {caption ? <p {...stylex.props(roleTone(palette, 'secondary'))}>{caption}</p> : null}
        <span {...stylex.props(util.srOnly)}>
          Sparkline with {data.length} points
          {caption ? `. ${caption}` : ''}
        </span>
      </GraphBody>
    </Graph>
  )
}

export type { GraphSparkProps }
