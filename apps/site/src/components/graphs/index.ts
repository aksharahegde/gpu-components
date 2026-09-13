/**
 * Barrel for the mdx-graphs.kshv.me-ported data-viz components. Ported onto this site's StyleX
 * token system rather than installed via the reference's shadcn registry (this repo has no
 * Tailwind/Framer Motion) — see `frame.tsx`/`motion.ts` for the shared primitives every component
 * below sits on. Import from here (`import { GraphTable } from '@/components/graphs'`), or from the
 * individual file if you only need one.
 */

export { Graph, GraphBody, GraphRule, GraphRuleY, GraphTrack, GraphTick, GraphTitle, GraphCorners } from './frame'
export { GraphArrow } from './arrow'
export {
  graphMotion,
  graphTone,
  graphFx,
  GLYPH_SETS,
  resolveGlyphs,
  trackMarks,
  clamp01,
  intensityLevel,
  intensityGlyph,
  intensityTone,
  isMonoPalette,
  seriesTone,
  seriesDimStyle,
  roleTone,
} from './motion'
export type { GraphPalette, Glyphs, GlyphSetName, GraphToneKey } from './motion'
export { parseInstant, pad2, formatHms, formatAgo, formatClock, useGraphNow } from './clock'

export { GraphTable } from './table'
export { GraphSheet } from './sheet'
export { GraphMatrix } from './matrix'
export { GraphCells } from './cells'
export { GraphRank } from './rank'
export { GraphCompare } from './compare'

export { GraphTimeline } from './timeline'
export { GraphGantt } from './gantt'
export { GraphActivity } from './activity'
export { GraphCalendar } from './calendar'
export { GraphUptime } from './uptime'
export { GraphTimer } from './timer'
export { GraphCountdown } from './countdown'

export { GraphKpi } from './kpi'
export { GraphStat } from './stat'
export { GraphMeter } from './meter'
export { GraphBullet } from './bullet'
export { GraphSlope } from './slope'
export { GraphDiff } from './diff'

export { GraphBars } from './bars'
export { GraphWaffle } from './waffle'
export { GraphFunnel } from './funnel'
export { GraphHeatmap } from './heatmap'
export { GraphPlot } from './plot'
export { GraphSpark } from './spark'
export { GraphStack } from './stack'
export { GraphWaterfall } from './waterfall'

export { GraphFlow } from './flow'
export { GraphTree } from './tree'
export { GraphCheck } from './check'
export { GraphInvoice } from './invoice'
export { GraphSpec } from './spec'
