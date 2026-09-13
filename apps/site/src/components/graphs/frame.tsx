'use client'

/**
 * The shared dashed-frame chrome every graph component sits inside — ported from
 * mdx-graphs.kshv.me's `graph-frame.tsx` onto this site's StyleX token system instead of
 * Tailwind/`cn()`. `+` corner marks and a bracketed `[ TITLE ]` caption over a dashed rule,
 * matching the reference's ASCII-frame convention (see `apps/site/DESIGN.md`).
 */

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { color, font } from '../../tokens.stylex'
import type { SX } from '../../ui'

const s = stylex.create({
  figure: {
    position: 'relative',
    width: '100%',
    minWidth: 0,
    margin: 0,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    fontFamily: font.mono,
    fontSize: 13,
    color: color.text,
  },
  corner: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 1,
    display: 'flex',
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bg,
    fontFamily: font.mono,
    fontSize: 13,
    lineHeight: 1,
    color: color.borderStrong,
    userSelect: 'none',
  },
  cornerTL: { insetBlockStart: 0, insetInlineStart: 0, transform: 'translate(-50%, -50%)' },
  cornerTR: { insetBlockStart: 0, insetInlineEnd: 0, transform: 'translate(50%, -50%)' },
  cornerBL: { insetBlockEnd: 0, insetInlineStart: 0, transform: 'translate(-50%, 50%)' },
  cornerBR: { insetBlockEnd: 0, insetInlineEnd: 0, transform: 'translate(50%, 50%)' },
  title: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: '50%',
    zIndex: 1,
    transform: 'translate(-50%, -50%)',
    backgroundColor: color.bg,
    paddingInline: 10,
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: font.mono,
    fontSize: 12,
  },
  titleInk: { color: color.accent },
  body: { minWidth: 0, padding: '28px 20px' },
  rule: {
    width: '100%',
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: color.border,
  },
  ruleY: {
    alignSelf: 'stretch',
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'dashed',
    borderInlineStartColor: color.border,
  },
  track: { display: 'flex', width: '100%', minWidth: 0, userSelect: 'none' },
  tick: { minWidth: 0, flex: 1, overflow: 'hidden', textAlign: 'center' },
})

export function GraphCorners({ mark = '+' }: { mark?: string }) {
  return (
    <>
      <span aria-hidden="true" {...stylex.props(s.corner, s.cornerTL)}>
        {mark}
      </span>
      <span aria-hidden="true" {...stylex.props(s.corner, s.cornerTR)}>
        {mark}
      </span>
      <span aria-hidden="true" {...stylex.props(s.corner, s.cornerBL)}>
        {mark}
      </span>
      <span aria-hidden="true" {...stylex.props(s.corner, s.cornerBR)}>
        {mark}
      </span>
    </>
  )
}

export function GraphTitle({ children, id, sx }: { children: React.ReactNode; id?: string; sx?: SX }) {
  return (
    <figcaption id={id} {...stylex.props(s.title, sx)}>
      <span {...stylex.props(s.titleInk)}>[ {children} ]</span>
    </figcaption>
  )
}

export function GraphBody({ children, sx }: { children: React.ReactNode; sx?: SX }) {
  return <div {...stylex.props(s.body, sx)}>{children}</div>
}

export function GraphRule({ sx }: { sx?: SX }) {
  return <div aria-hidden="true" {...stylex.props(s.rule, sx)} />
}

export function GraphRuleY({ sx }: { sx?: SX }) {
  return <div aria-hidden="true" {...stylex.props(s.ruleY, sx)} />
}

export function GraphTrack({ children, sx }: { children: React.ReactNode; sx?: SX }) {
  return (
    <span aria-hidden="true" {...stylex.props(s.track, sx)}>
      {children}
    </span>
  )
}

export function GraphTick({ children, sx }: { children?: React.ReactNode; sx?: SX }) {
  return <span {...stylex.props(s.tick, sx)}>{children}</span>
}

/**
 * The frame every graph renders inside. `title` is optional — an untitled graph (e.g. one already
 * captioned by the page's own `<Section>`) skips the bracketed caption but keeps the corner marks.
 */
export function Graph({
  title,
  corner = '+',
  children,
  sx,
}: {
  title?: string
  corner?: string
  children: React.ReactNode
  sx?: SX
}) {
  const captionId = React.useId()
  return (
    <figure aria-labelledby={title ? captionId : undefined} {...stylex.props(s.figure, sx)}>
      {title ? <GraphTitle id={captionId}>{title}</GraphTitle> : null}
      <GraphCorners mark={corner} />
      {children}
    </figure>
  )
}
