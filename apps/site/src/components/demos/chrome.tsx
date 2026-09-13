'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GpuRuntimeOptions } from '@gpuc/core'
import { color, font, radius, shadow } from '../../tokens.stylex'

/**
 * Shared chrome for the per-component demo pages.
 *
 * Extracted when the single playground was split into a page per component: four copies of the same
 * control strip, readout panel and hint row would drift apart, and the differences between the demos
 * are supposed to be the *components*, not their frames.
 */

/**
 * Shared by every demo's `<GPUProvider options={...}>`. One frozen object, not one per demo: the
 * provider warns if its `options` identity changes after its runtime exists, and `clearColor` is a
 * page-wide decision rather than a per-component one.
 *
 * `clearColor` is vgpu's `[r, g, b, a]` in 0-1. It is `color.bgRaised` (#f2f2f2) — the same colour
 * `s.stage` paints behind the canvas — so a GPU surface is indistinguishable from its container
 * instead of clearing to vgpu's default opaque black. The channel values are raw sRGB because the
 * preferred canvas format is non-`-srgb`, which is also the space the components' WGSL colour
 * literals are written in.
 */
export const PROVIDER_OPTIONS = {
  profiling: true,
  clearColor: [242 / 255, 242 / 255, 242 / 255, 1],
} as const satisfies GpuRuntimeOptions

/** Deterministic PRNG, so every visitor sees the identical dataset. */
export function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const fmtInt = (n: number) => n.toLocaleString('en-US')

export function fmtMs(ms: number): string {
  if (Math.abs(ms) >= 1000) return `${(ms / 1000).toFixed(3)}s`
  if (Math.abs(ms) >= 1) return `${ms.toFixed(2)}ms`
  if (Math.abs(ms) >= 0.001) return `${(ms * 1000).toFixed(1)}µs`
  return `${(ms * 1e6).toFixed(0)}ns`
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div {...stylex.props(s.field)}>
      <span {...stylex.props(s.fieldLabel)}>{label}</span>
      {children}
    </div>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[]
  value: T
  onChange: (next: T) => void
  format?: (option: T) => string
}) {
  return (
    <div {...stylex.props(s.segmented)}>
      {options.map((option) => (
        <button
          key={String(option)}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={option === value}
          {...stylex.props(s.seg, option === value && s.segOn)}
        >
          {format ? format(option) : String(option)}
        </button>
      ))}
    </div>
  )
}

export function Btn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} {...stylex.props(s.reset)}>
      {children}
    </button>
  )
}

export function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div {...stylex.props(s.readout)}>
      <span {...stylex.props(s.readoutLabel)}>{label}</span>
      <span {...stylex.props(s.readoutValue)}>{children}</span>
    </div>
  )
}

export function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span {...stylex.props(s.hint)}>
      <kbd {...stylex.props(s.kbd)}>{keys}</kbd>
      {children}
    </span>
  )
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div {...stylex.props(s.panel)}>
      <div {...stylex.props(s.panelTitle)}>{title}</div>
      {children}
    </div>
  )
}

export function Dim({ children }: { children: ReactNode }) {
  return <span {...stylex.props(s.dim)}>{children}</span>
}

export const s = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: 14 },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  segmented: {
    display: 'flex',
    gap: 2,
    padding: 2,
    backgroundColor: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  seg: {
    fontFamily: font.mono,
    fontSize: 12,
    padding: '5px 10px',
    color: color.textDim,
    backgroundColor: { default: 'transparent', ':hover': color.surface2 },
    border: 'none',
    borderRadius: radius.sm,
    cursor: 'pointer',
  },
  segOn: { color: color.onAccent, backgroundColor: { default: color.accent, ':hover': color.accent } },
  reset: {
    fontFamily: font.mono,
    fontSize: 12,
    padding: '7px 12px',
    color: color.textDim,
    backgroundColor: { default: color.surface, ':hover': color.surface2 },
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    cursor: 'pointer',
  },
  blurb: { margin: 0, fontSize: 13, color: color.textDim },
  stage: {
    position: 'relative',
    height: 440,
    minHeight: 440,
    overflow: 'hidden',
    backgroundColor: color.bgRaised,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    // The one place a demo page earns elevation: the stage is the thing being looked at, and on a
    // flat white page a hairline alone does not lift it off the background.
    boxShadow: shadow.sm,
  },
  stageShort: { height: 340, minHeight: 340 },
  overlayMsg: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 1.6,
    color: color.textDim,
  },
  strong: { color: color.text },
  hints: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 12, color: color.textFaint },
  hint: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  kbd: {
    fontFamily: font.mono,
    fontSize: 11,
    padding: '2px 6px',
    color: color.textDim,
    backgroundColor: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  panels: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 14,
    backgroundColor: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  panelTitle: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: color.textFaint,
    marginBottom: 4,
  },
  readout: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 },
  readoutLabel: { color: color.textFaint },
  // Tabular figures: these readouts update per frame (hovered index, selected count, frame times),
  // and proportional digits make the value jitter horizontally as it changes.
  readoutValue: {
    fontFamily: font.mono,
    fontVariantNumeric: 'tabular-nums',
    color: color.text,
    textAlign: 'right',
    wordBreak: 'break-word',
  },
  dim: { color: color.textFaint },
  note: { margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.6, color: color.textFaint },
  inspector: { fontSize: 11, fontFamily: font.mono, color: color.textDim, overflowX: 'auto' },
  footnote: { margin: 0, fontSize: 12.5, lineHeight: 1.7, color: color.textFaint },
  inspectorPanel: { gridColumn: 'auto' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' },
})

/**
 * Measures the demo stage and keeps a viewport's pixel size in sync with it.
 *
 * Every component sizes itself from `viewport.width/height` rather than observing its own canvas —
 * PLAN.md §11.1's "the DOM stays in charge of layout" — so each demo needs this, and four copies
 * would be four chances to get the resize handling subtly different.
 */
export function useMeasuredStage(initial: { width: number; height: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState(initial)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setBox({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  return { ref, box }
}
