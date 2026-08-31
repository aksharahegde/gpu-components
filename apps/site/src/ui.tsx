import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { StyleXStyles } from '@stylexjs/stylex'
import { color, font, radius, size } from './tokens.stylex'

/** Anything `stylex.props()` accepts. */
export type SX = StyleXStyles | false | null | undefined | readonly SX[]

/**
 * Breakpoints, inlined per file rather than shared via `stylex.defineConsts`.
 * `@stylexjs/babel-plugin` 0.19.0's `defineConsts` cross-file constant
 * hoisting does not resolve back to real `@media` text when StyleX's rules
 * are collected in a single app-wide batch — as this project's webpack/Next
 * pipeline does — producing invalid CSS (`var(--hash){...}` with no matching
 * declaration) that crashes lightningcss at build time. Verified with a
 * minimal repro against the babel plugin directly. A same-file `const`
 * sidesteps that code path entirely: StyleX evaluates it locally, with no
 * cross-file indirection to resolve.
 */
const SM = '@media (max-width: 620px)'
const MD = '@media (max-width: 900px)'

/* ── layout ─────────────────────────────────────────────────────────────── */

const layout = stylex.create({
  wrap: {
    maxWidth: size.maxWidth,
    marginInline: 'auto',
    paddingInline: size.gutter,
  },
  stack: { display: 'flex', flexDirection: 'column' },
  row: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap' },
  gap: (n: number) => ({ gap: n }),
  grid: { display: 'grid', gap: 16 },
  cols2: {
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [SM]: 'minmax(0, 1fr)',
    },
  },
  cols3: {
    gridTemplateColumns: {
      default: 'repeat(3, minmax(0, 1fr))',
      [MD]: 'repeat(2, minmax(0, 1fr))',
      [SM]: 'minmax(0, 1fr)',
    },
  },
  cols4: {
    gridTemplateColumns: {
      default: 'repeat(4, minmax(0, 1fr))',
      [MD]: 'repeat(2, minmax(0, 1fr))',
      [SM]: 'minmax(0, 1fr)',
    },
  },
})

export function Wrap({ children, sx }: { children: ReactNode; sx?: SX }) {
  return <div {...stylex.props(layout.wrap, sx)}>{children}</div>
}

export function Stack({
  children,
  gap = 16,
  sx,
}: {
  children: ReactNode
  gap?: number
  sx?: SX
}) {
  return <div {...stylex.props(layout.stack, layout.gap(gap), sx)}>{children}</div>
}

export function Row({
  children,
  gap = 12,
  sx,
}: {
  children: ReactNode
  gap?: number
  sx?: SX
}) {
  return <div {...stylex.props(layout.row, layout.gap(gap), sx)}>{children}</div>
}

export function Grid({
  children,
  cols = 2,
  gap = 16,
  sx,
}: {
  children: ReactNode
  cols?: 2 | 3 | 4
  gap?: number
  sx?: SX
}) {
  const colStyle = cols === 2 ? layout.cols2 : cols === 3 ? layout.cols3 : layout.cols4
  return <div {...stylex.props(layout.grid, colStyle, layout.gap(gap), sx)}>{children}</div>
}

/* ── typography ─────────────────────────────────────────────────────────── */

const text = stylex.create({
  eyebrow: {
    fontFamily: font.mono,
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  h1: {
    fontSize: 'clamp(34px, 5.4vw, 58px)',
    lineHeight: 1.08,
    letterSpacing: '-0.035em',
    fontWeight: 620,
    color: color.text,
  },
  h1Page: { fontSize: 'clamp(30px, 4vw, 44px)' },
  h2: {
    fontSize: 'clamp(24px, 3vw, 32px)',
    lineHeight: 1.15,
    letterSpacing: '-0.028em',
    fontWeight: 620,
    color: color.text,
  },
  h3: {
    fontSize: 18,
    lineHeight: 1.25,
    letterSpacing: '-0.015em',
    fontWeight: 620,
    color: color.text,
  },
  h3sm: { fontSize: 16 },
  lead: {
    fontSize: 'clamp(16px, 1.6vw, 19px)',
    lineHeight: 1.6,
    color: color.textDim,
    maxWidth: '68ch',
  },
  body: { color: color.textDim, lineHeight: 1.65, maxWidth: '74ch' },
  /** Same colour as `body` but with no block constraints — for inline spans. */
  bodyInline: { color: color.textDim },
  bodySm: { fontSize: 14.5 },
  small: { fontSize: 14, lineHeight: 1.6, color: color.textFaint },
  mono: { fontFamily: font.mono },
  strong: { color: color.text, fontWeight: 600 },
  accent: { color: color.accent },
  mint: { color: color.mint },
  amber: { color: color.amber },
})

export function Eyebrow({ children, sx }: { children: ReactNode; sx?: SX }) {
  return <div {...stylex.props(text.eyebrow, sx)}>{children}</div>
}
export function H1({ children, page, sx }: { children: ReactNode; page?: boolean; sx?: SX }) {
  return <h1 {...stylex.props(text.h1, page && text.h1Page, sx)}>{children}</h1>
}
export function H2({ children, sx }: { children: ReactNode; sx?: SX }) {
  return <h2 {...stylex.props(text.h2, sx)}>{children}</h2>
}
export function H3({ children, sm, sx }: { children: ReactNode; sm?: boolean; sx?: SX }) {
  return <h3 {...stylex.props(text.h3, sm && text.h3sm, sx)}>{children}</h3>
}
export function Lead({ children, sx }: { children: ReactNode; sx?: SX }) {
  return <p {...stylex.props(text.lead, sx)}>{children}</p>
}
export function Body({ children, sm, sx }: { children: ReactNode; sm?: boolean; sx?: SX }) {
  return <p {...stylex.props(text.body, sm && text.bodySm, sx)}>{children}</p>
}
export function Small({ children, sx }: { children: ReactNode; sx?: SX }) {
  return <p {...stylex.props(text.small, sx)}>{children}</p>
}
export function B({ children, sx }: { children: ReactNode; sx?: SX }) {
  return <strong {...stylex.props(text.strong, sx)}>{children}</strong>
}
export function Mono({ children, sx }: { children: ReactNode; sx?: SX }) {
  return <span {...stylex.props(text.mono, sx)}>{children}</span>
}

export const tone = { accent: text.accent, mint: text.mint, amber: text.amber } as const
export const typo = text

/* ── surfaces ───────────────────────────────────────────────────────────── */

const surface = stylex.create({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: 22,
  },
  cardLg: { padding: 28 },
  section: {
    paddingBlock: 84,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  sectionFlush: { borderTopWidth: 0 },
  pageHead: {
    paddingBlock: '64px 40px',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  notice: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderInlineStartWidth: 3,
    borderRadius: radius.md,
    padding: '16px 18px',
    fontSize: 14.5,
    lineHeight: 1.6,
    color: color.textDim,
  },
  noticeAmber: {
    borderInlineStartColor: color.amber,
    backgroundColor: `color-mix(in srgb, ${color.amber} 6%, ${color.surface})`,
  },
  noticeAccent: {
    borderInlineStartColor: color.accent,
    backgroundColor: `color-mix(in srgb, ${color.accent} 6%, ${color.surface})`,
  },
})

export function Card({
  children,
  lg,
  sx,
}: {
  children: ReactNode
  lg?: boolean
  sx?: SX
}) {
  return <div {...stylex.props(surface.card, lg && surface.cardLg, sx)}>{children}</div>
}

export function Notice({
  children,
  variant = 'amber',
}: {
  children: ReactNode
  variant?: 'amber' | 'accent'
}) {
  return (
    <div
      {...stylex.props(
        surface.notice,
        variant === 'accent' ? surface.noticeAccent : surface.noticeAmber,
      )}
    >
      {children}
    </div>
  )
}

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  flush,
}: {
  id?: string
  eyebrow?: string
  title?: string
  lead?: ReactNode
  children?: ReactNode
  flush?: boolean
}) {
  return (
    <section id={id} {...stylex.props(surface.section, flush && surface.sectionFlush)}>
      <Wrap>
        <Stack gap={32}>
          {(eyebrow || title || lead) && (
            <Stack gap={12}>
              {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
              {title && <H2>{title}</H2>}
              {lead && <Lead>{lead}</Lead>}
            </Stack>
          )}
          {children}
        </Stack>
      </Wrap>
    </section>
  )
}

export function PageHead({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string
  title: string
  lead: ReactNode
}) {
  return (
    <div {...stylex.props(surface.pageHead)}>
      <Wrap>
        <Stack gap={12}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <H1 page>{title}</H1>
          <Lead>{lead}</Lead>
        </Stack>
      </Wrap>
    </div>
  )
}

/* ── chips ──────────────────────────────────────────────────────────────── */

const chip = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontFamily: font.mono,
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    color: color.textDim,
    whiteSpace: 'nowrap',
  },
  dot: { width: 6, height: 6, borderRadius: radius.pill, flex: 'none' },
  planned: { backgroundColor: color.textFaint },
  progress: { backgroundColor: color.amber },
  done: { backgroundColor: color.mint },
  live: { backgroundColor: color.accent },
})

export function Chip({ children }: { children: ReactNode }) {
  return <span {...stylex.props(chip.base)}>{children}</span>
}

export function Status({
  state,
  children,
}: {
  state: 'planned' | 'progress' | 'done' | 'live'
  children: ReactNode
}) {
  return (
    <span {...stylex.props(chip.base)}>
      <span {...stylex.props(chip.dot, chip[state])} />
      {children}
    </span>
  )
}

/* ── buttons ────────────────────────────────────────────────────────────── */

export const button = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 17px',
    borderRadius: radius.md,
    fontSize: 14.5,
    fontWeight: 550,
    fontFamily: 'inherit',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.borderStrong, ':hover': color.borderHover },
    backgroundColor: { default: color.surface, ':hover': color.surface2 },
    color: color.text,
    cursor: 'pointer',
    textDecoration: { default: 'none', ':hover': 'none' },
    transitionProperty: 'background-color, border-color',
    transitionDuration: '140ms',
    transitionTimingFunction: 'ease',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: { default: 0, ':focus-visible': 2 },
  },
  primary: {
    backgroundColor: { default: color.accent, ':hover': color.accentHover },
    borderColor: { default: color.accent, ':hover': color.accentHover },
    color: color.onAccent,
    fontWeight: 620,
  },
})

export function Btn({
  children,
  onClick,
  primary,
  type = 'button',
  sx,
  ...rest
}: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  type?: 'button' | 'submit'
  sx?: SX
} & { 'aria-expanded'?: boolean; title?: string }) {
  return (
    <button
      type={type}
      onClick={onClick}
      {...stylex.props(button.base, primary && button.primary, sx)}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ── lists ──────────────────────────────────────────────────────────────── */

const list = stylex.create({
  ul: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 },
  li: { display: 'flex', gap: 10, color: color.textDim, lineHeight: 1.65 },
  marker: { flex: 'none', userSelect: 'none' },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: color.accentDim,
    marginBlockStart: 10,
    marginInlineStart: 3,
  },
  glyph: { fontSize: 12, lineHeight: 1.6, width: 13 },
  check: { color: color.mint },
  cross: { color: color.rose, fontSize: 11 },
  sm: { fontSize: 14.5 },
})

type ListVariant = 'bullet' | 'check' | 'cross'

/**
 * StyleX has no descendant selectors and prefers real elements over `::before`,
 * so the marker is an actual span rather than generated content. It also makes
 * the check/cross lists announce correctly instead of leaking punctuation.
 */
export function List({
  children,
  variant = 'bullet',
  sm,
}: {
  children: ReactNode
  variant?: ListVariant
  sm?: boolean
}) {
  return (
    <ul {...stylex.props(list.ul, sm && list.sm)} data-variant={variant}>
      {children}
    </ul>
  )
}

export function LI({ children, variant = 'bullet' }: { children: ReactNode; variant?: ListVariant }) {
  return (
    <li {...stylex.props(list.li)}>
      {variant === 'bullet' ? (
        <span aria-hidden="true" {...stylex.props(list.marker, list.bullet)} />
      ) : (
        <span aria-hidden="true" {...stylex.props(list.marker, list.glyph, list[variant])}>
          {variant === 'check' ? '✓' : '✕'}
        </span>
      )}
      <span>{children}</span>
    </li>
  )
}

/* ── tables ─────────────────────────────────────────────────────────────── */

const table = stylex.create({
  scroll: {
    overflowX: 'auto',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
  },
  table: { width: '100%', fontSize: 14, minWidth: 560 },
  tableNarrow: { minWidth: 380 },
  cell: {
    textAlign: 'left',
    padding: '11px 16px',
    verticalAlign: 'top',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
    color: color.textDim,
  },
  th: {
    backgroundColor: color.surface,
    color: color.textFaint,
    fontFamily: font.mono,
    fontSize: 11.5,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  last: { borderBottomWidth: 0 },
  mono: { fontFamily: font.mono, fontSize: 13 },
})

export function TableScroll({ children }: { children: ReactNode }) {
  return <div {...stylex.props(table.scroll)}>{children}</div>
}
export function Table({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <table {...stylex.props(table.table, narrow && table.tableNarrow)}>{children}</table>
}
export function Th({ children }: { children?: ReactNode }) {
  return <th {...stylex.props(table.cell, table.th)}>{children}</th>
}
export function Td({
  children,
  last,
  mono,
}: {
  children?: ReactNode
  last?: boolean
  mono?: boolean
}) {
  return <td {...stylex.props(table.cell, mono && table.mono, last && table.last)}>{children}</td>
}

/* ── code ───────────────────────────────────────────────────────────────── */

const code = stylex.create({
  block: {
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '9px 14px',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
    backgroundColor: color.surface,
    fontFamily: font.mono,
    fontSize: 12,
    color: color.textFaint,
  },
  pre: {
    margin: 0,
    padding: '16px 18px',
    overflowX: 'auto',
    fontFamily: font.mono,
    fontSize: 13,
    lineHeight: 1.7,
    color: color.codeText,
    tabSize: 2,
  },
  comment: { color: color.codeComment },
  keyword: { color: color.codeKeyword },
  string: { color: color.codeString },
  fn: { color: color.codeFn },
  num: { color: color.codeNum },
  inline: {
    fontFamily: font.mono,
    fontSize: '0.875em',
    backgroundColor: color.surface2,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: '1.5px 5px',
    color: color.codeInline,
    whiteSpace: 'nowrap',
  },
})

export function Code({ file, children }: { file: string; children: ReactNode }) {
  return (
    <div {...stylex.props(code.block)}>
      <div {...stylex.props(code.bar)}>
        <span>{file}</span>
      </div>
      <pre {...stylex.props(code.pre)}>
        <code>{children}</code>
      </pre>
    </div>
  )
}

/** Inline `<code>` in prose. */
export function C({ children }: { children: ReactNode }) {
  return <code {...stylex.props(code.inline)}>{children}</code>
}

/* Tiny token helpers — six snippets on the whole site does not justify a
   syntax highlighter dependency. */
export const c = (s: string) => <span {...stylex.props(code.comment)}>{s}</span>
export const k = (s: string) => <span {...stylex.props(code.keyword)}>{s}</span>
export const str = (s: string) => <span {...stylex.props(code.string)}>{s}</span>
export const fn = (s: string) => <span {...stylex.props(code.fn)}>{s}</span>
export const num = (s: string) => <span {...stylex.props(code.num)}>{s}</span>

/* ── one-off helpers used across pages ──────────────────────────────────── */

export const util = stylex.create({
  flex1: { flex: 1 },
  minW0: { minWidth: 0 },
  alignStart: { alignItems: 'flex-start' },
  alignEnd: { alignSelf: 'flex-end' },
  textRight: { textAlign: 'right' },
  narrow: { maxWidth: '54ch' },
  wide: { maxWidth: '78ch' },
  center: { alignItems: 'center' },
  monoSm: { fontFamily: font.mono, fontSize: 13 },
  tabular: { fontVariantNumeric: 'tabular-nums' },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
