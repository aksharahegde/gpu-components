import * as stylex from '@stylexjs/stylex'
import { color, font, radius } from '../tokens.stylex'

const LAYERS = [
  { name: 'Application', who: 'your code', kind: 'plain' },
  { name: '@gpu-components/react', who: 'ours · npm', kind: 'ours' },
  { name: 'components/gpu/timeline/*', who: 'yours · copied', kind: 'copied' },
  { name: '@gpu-components/core', who: 'ours · npm', kind: 'ours' },
  { name: 'vgpu', who: 'upstream', kind: 'plain' },
  { name: 'WebGPU', who: 'browser', kind: 'plain' },
] as const

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
  ours: {
    borderColor: `color-mix(in srgb, ${color.accent} 42%, ${color.border})`,
    backgroundColor: `color-mix(in srgb, ${color.accent} 9%, ${color.surface})`,
  },
  copied: {
    borderStyle: 'dashed',
    borderColor: `color-mix(in srgb, ${color.mint} 34%, ${color.border})`,
  },
  name: { fontFamily: font.mono, color: color.text },
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
  arrow: { textAlign: 'center', color: color.textFaint, fontSize: 11, lineHeight: 1 },
})

export function Layers() {
  return (
    <div {...stylex.props(s.stack)} role="list" aria-label="Architecture layer stack, top to bottom">
      {LAYERS.map((l, i) => (
        <div key={l.name}>
          <div
            role="listitem"
            {...stylex.props(
              s.layer,
              l.kind === 'ours' && s.ours,
              l.kind === 'copied' && s.copied,
            )}
          >
            <span {...stylex.props(s.name)}>{l.name}</span>
            <span
              {...stylex.props(
                s.who,
                l.kind === 'ours' && s.whoOurs,
                l.kind === 'copied' && s.whoCopied,
              )}
            >
              {l.who}
            </span>
          </div>
          {i < LAYERS.length - 1 && (
            <div {...stylex.props(s.arrow)} aria-hidden="true">
              ↓
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
