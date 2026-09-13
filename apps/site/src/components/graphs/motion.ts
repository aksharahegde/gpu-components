import * as stylex from '@stylexjs/stylex'
import { color } from '../../tokens.stylex'

const REDUCE = '@media (prefers-reduced-motion: reduce)'
const EASE_OUT_CUBIC = 'cubic-bezier(0.215, 0.61, 0.355, 1)'

/**
 * Ported from mdx-graphs.kshv.me's `graph-motion.ts`. The reference drives entrance motion through
 * `motion/react` (framer-motion) Variants; this site has no such dependency and already gets
 * "opacity/transform, ~220ms, no loops" for free from the global `prefers-reduced-motion` override
 * in `globals.css`, so a CSS `@keyframes` (declared there as `graph-fade-up`) does the same job
 * `fadeUp`/`graphTransition` did in the source, with no new dependency and no per-component reduce
 * check — same convention as `heroMotion.stylex.ts`.
 */
export const graphMotion = stylex.create({
  fadeUp: {
    animationName: { default: 'graph-fade-up', [REDUCE]: 'none' },
    animationDuration: '220ms',
    animationTimingFunction: EASE_OUT_CUBIC,
    animationFillMode: 'backwards',
  },
})

export const DIM_OPACITY = 0.4

/** Applied to a non-highlighted series in a `mono`-palette multi-series graph. */
export const graphFx = stylex.create({
  dim: { opacity: DIM_OPACITY },
})

/**
 * Color roles, ported from the reference's `text-graph-*` Tailwind classes. The reference has three
 * real accent hues (`graph-accent`/`-2`/`-3`); this site runs a single-accent, grayscale-otherwise
 * palette (see `tokens.stylex.ts`), so "series 2" and "series 3" become weight steps in the gray
 * ramp instead of new hues — the same collapse the main redesign applied to `mint`/`amber`.
 */
export const graphTone = stylex.create({
  frame: { color: color.borderStrong },
  muted: { color: color.textFaint },
  ink: { color: color.text },
  accent: { color: color.accent },
  accent2: { color: color.textDim },
  accent3: { color: color.text },
})

export type GraphToneKey = keyof typeof graphTone

export const GLYPH_SETS = {
  shade: ['·', '░', '▒', '▓', '█'],
  ascii: ['.', '-', '=', '#', '@'],
  hash: ['.', ':', '+', '#', '█'],
  bar: ['▁', '▂', '▃', '▅', '█'],
} as const

export type GlyphSetName = keyof typeof GLYPH_SETS
export type Glyphs = GlyphSetName | readonly string[]

export const INTENSITY_GLYPHS = GLYPH_SETS.shade

export function resolveGlyphs(glyphs?: Glyphs): readonly string[] {
  if (glyphs == null) return GLYPH_SETS.shade
  if (typeof glyphs === 'string') return GLYPH_SETS[glyphs] ?? GLYPH_SETS.shade
  return glyphs.length > 0 ? glyphs : GLYPH_SETS.shade
}

export function trackMarks(
  glyphs?: Glyphs,
  fallback: { empty: string; rest: string; fill: string } = { empty: '-', rest: '░', fill: '█' },
) {
  if (glyphs == null) return fallback
  const set = resolveGlyphs(glyphs)
  const last = set.length - 1
  return {
    empty: set[0] ?? fallback.empty,
    rest: set[Math.min(1, last)] ?? fallback.rest,
    fill: set[last] ?? fallback.fill,
  }
}

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function intensityLevel(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0
  return Math.max(1, Math.round(clamp01(value / max) * 4))
}

export function intensityGlyph(level: number, glyphs: readonly string[] = INTENSITY_GLYPHS) {
  if (glyphs.length === 0) return '·'
  const clamped = Math.min(4, Math.max(0, Math.round(level)))
  const index = Math.round((clamped / 4) * (glyphs.length - 1))
  return glyphs[index] ?? glyphs[0] ?? '·'
}

export type GraphPalette = 'mono' | 'duo' | 'multi'

/** Ported from `intensityClass` — returns a `graphTone` style object instead of a class name. */
export function intensityTone(level: number, palette: GraphPalette = 'mono') {
  const index = Math.min(4, Math.max(0, Math.round(level)))
  if (index <= 0) return graphTone.frame
  if (palette === 'mono') {
    if (index <= 2) return graphTone.muted
    if (index === 3) return graphTone.ink
    return graphTone.accent
  }
  if (palette === 'multi') {
    if (index === 1) return graphTone.accent2
    if (index <= 3) return graphTone.accent3
    return graphTone.accent
  }
  if (index <= 2) return graphTone.accent2
  return graphTone.accent
}

const SERIES_TONES = [graphTone.accent, graphTone.accent2, graphTone.accent3] as const

export function isMonoPalette(palette?: GraphPalette) {
  return palette == null || palette === 'mono'
}

/** Ported from `seriesClass` — returns a `graphTone` style object instead of a class name. */
export function seriesTone(palette: GraphPalette | undefined, index: number) {
  if (isMonoPalette(palette)) return index === 0 ? graphTone.accent : graphTone.ink
  const count = palette === 'duo' ? 2 : 3
  return SERIES_TONES[index % count]
}

/** Ported from `seriesDim` — returns a `graphFx` style object instead of an inline opacity. */
export function seriesDimStyle(palette: GraphPalette | undefined, highlighted: boolean) {
  if (!isMonoPalette(palette) || highlighted) return undefined
  return graphFx.dim
}

/** Ported from `toneClass` — returns a `graphTone` style object instead of a class name. */
export function roleTone(palette: GraphPalette | undefined, role: 'primary' | 'secondary' | 'idle' | 'empty') {
  if (role === 'empty') return graphTone.frame
  if (role === 'idle') return graphTone.muted
  if (role === 'primary') return graphTone.accent
  return isMonoPalette(palette) ? graphTone.muted : graphTone.accent2
}
