import * as stylex from '@stylexjs/stylex'
import type { CSSProperties } from 'react'
import { arrowRevealDelay, heroMotion, layerRevealDelay } from '../heroMotion.stylex'
import { color, font, radius } from '../tokens.stylex'

type LayerKind = 'app' | 'ours' | 'copied' | 'upstream' | 'foundation'

const LAYERS: Array<{ name: string; who: string; kind: LayerKind }> = [
  { name: 'Application', who: 'your code', kind: 'app' },
  { name: '@gpu-components/react', who: 'ours · npm', kind: 'ours' },
  { name: 'components/gpu/timeline/*', who: 'yours · copied', kind: 'copied' },
  { name: '@gpu-components/core', who: 'ours · npm', kind: 'ours' },
  { name: 'vgpu', who: 'upstream', kind: 'upstream' },
  { name: 'WebGPU', who: 'browser', kind: 'foundation' },
]

const s = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 5 },
  layer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    padding: '12px 15px',
    fontSize: 13.5,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  app: {
    backgroundColor: color.surface2,
    borderColor: color.borderStrong,
  },
  ours: {
    borderColor: `color-mix(in srgb, ${color.accent} 48%, ${color.border})`,
    backgroundColor: `color-mix(in srgb, ${color.accent} 11%, ${color.surface})`,
  },
  copied: {
    borderStyle: 'dashed',
    borderColor: `color-mix(in srgb, ${color.mint} 40%, ${color.border})`,
    backgroundColor: `color-mix(in srgb, ${color.mint} 8%, ${color.surface})`,
  },
  upstream: {
    borderColor: `color-mix(in srgb, ${color.amber} 32%, ${color.border})`,
    backgroundColor: `color-mix(in srgb, ${color.amber} 6%, ${color.surface})`,
  },
  foundation: {
    borderColor: `color-mix(in srgb, ${color.accentDim} 58%, ${color.border})`,
    backgroundColor: `color-mix(in srgb, ${color.accentDim} 14%, ${color.surface})`,
  },
  name: { fontFamily: font.mono, color: color.text },
  nameApp: { color: color.text },
  nameFoundation: { color: `color-mix(in srgb, ${color.accent} 78%, ${color.text})` },
  who: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: color.textFaint,
    whiteSpace: 'nowrap',
  },
  whoOurs: { color: color.accent },
  whoCopied: { color: color.mint },
  whoUpstream: { color: color.amber },
  whoFoundation: { color: color.accentDim },
  arrow: { textAlign: 'center', color: color.textFaint, fontSize: 11, lineHeight: 1 },
  arrowAccent: { color: `color-mix(in srgb, ${color.accent} 72%, ${color.textFaint})` },
  arrowMint: { color: `color-mix(in srgb, ${color.mint} 68%, ${color.textFaint})` },
})

function layerStyles(kind: LayerKind) {
  switch (kind) {
    case 'app':
      return s.app
    case 'ours':
      return s.ours
    case 'copied':
      return s.copied
    case 'upstream':
      return s.upstream
    case 'foundation':
      return s.foundation
  }
}

function whoStyles(kind: LayerKind) {
  switch (kind) {
    case 'ours':
      return s.whoOurs
    case 'copied':
      return s.whoCopied
    case 'upstream':
      return s.whoUpstream
    case 'foundation':
      return s.whoFoundation
    default:
      return null
  }
}

function nameStyles(kind: LayerKind) {
  switch (kind) {
    case 'app':
      return s.nameApp
    case 'foundation':
      return s.nameFoundation
    default:
      return null
  }
}

function arrowStyles(above: LayerKind, below: LayerKind) {
  if (above === 'ours' || below === 'ours') return s.arrowAccent
  if (above === 'copied' || below === 'copied') return s.arrowMint
  return null
}

export function Layers() {
  const count = LAYERS.length

  return (
    <div {...stylex.props(s.stack)} role="list" aria-label="Architecture layer stack, top to bottom">
      {LAYERS.map((l, i) => (
        <div key={l.name}>
          <div
            role="listitem"
            {...stylex.props(s.layer, heroMotion.layerIn, layerStyles(l.kind))}
            style={{ animationDelay: layerRevealDelay(i, count) } as CSSProperties}
          >
            <span {...stylex.props(s.name, nameStyles(l.kind))}>{l.name}</span>
            <span {...stylex.props(s.who, whoStyles(l.kind))}>{l.who}</span>
          </div>
          {i < count - 1 && (
            <div
              {...stylex.props(s.arrow, heroMotion.arrowIn, arrowStyles(l.kind, LAYERS[i + 1]!.kind))}
              style={{ animationDelay: arrowRevealDelay(i, count) } as CSSProperties}
              aria-hidden="true"
            >
              ↓
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
