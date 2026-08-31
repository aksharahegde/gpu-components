'use client'

import { useEffect, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { usePathname } from 'next/navigation'
import { Link, useIsCurrent } from '../link'
import { useTheme } from '../theme'
import { color, font, radius, size } from '../tokens.stylex'
import { Btn, Small, Stack, Wrap, typo, util } from '../ui'

const ROUTES: Array<{ to: string; label: string; section?: boolean }> = [
  { to: '/playground', label: 'Playground', section: true },
  { to: '/why-gpu', label: 'Why GPU' },
  { to: '/architecture', label: 'Architecture' },
  { to: '/components', label: 'Components' },
  { to: '/start', label: 'Get started' },
]

/** Inlined rather than shared — see `ui.tsx`'s equivalent comment. */
const NAV = '@media (max-width: 720px)'

const s = stylex.create({
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
    backgroundColor: `color-mix(in srgb, ${color.bg} 86%, transparent)`,
    backdropFilter: 'blur(12px)',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  inner: { display: 'flex', alignItems: 'center', gap: 28, height: size.navHeight },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    color: { default: color.text, ':hover': color.text },
    fontFamily: font.mono,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    textDecoration: { default: 'none', ':hover': 'none' },
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: { default: 0, ':focus-visible': 2 },
    borderRadius: radius.sm,
  },
  mark: { display: 'block', flex: 'none' },
  links: {
    display: { default: 'flex', [NAV]: 'none' },
    gap: 22,
    marginInlineStart: 'auto',
    alignItems: 'center',
  },
  // Only the mobile branch differs; on desktop the open state is a no-op.
  linksOpen: {
    display: { default: 'flex', [NAV]: 'flex' },
    position: { default: 'static', [NAV]: 'absolute' },
    insetBlockStart: { default: 'auto', [NAV]: size.navHeight },
    insetInlineStart: { default: 'auto', [NAV]: 0 },
    insetInlineEnd: { default: 'auto', [NAV]: 0 },
    flexDirection: { default: 'row', [NAV]: 'column' },
    gap: { default: 22, [NAV]: 0 },
    alignItems: { default: 'center', [NAV]: 'stretch' },
    backgroundColor: { default: 'transparent', [NAV]: color.bgRaised },
    borderBottomWidth: { default: 0, [NAV]: 1 },
    borderBottomStyle: 'solid',
    borderBottomColor: { default: 'transparent', [NAV]: color.border },
    padding: { default: 0, [NAV]: '8px 24px 16px' },
    zIndex: { default: 'auto', [NAV]: 1 },
  },
  link: {
    color: { default: color.textDim, ':hover': color.text },
    fontSize: 14,
    paddingBlock: { default: 4, [NAV]: 12 },
    borderBottomWidth: 1.5,
    borderBottomStyle: 'solid',
    borderBottomColor: { default: 'transparent', [NAV]: color.border },
    width: { default: 'auto', [NAV]: '100%' },
    textDecoration: { default: 'none', ':hover': 'none' },
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: { default: 0, ':focus-visible': 2 },
    borderRadius: radius.sm,
    transitionProperty: 'color, border-color',
    transitionDuration: '140ms',
    transitionTimingFunction: 'ease',
  },
  // The active indicator is applied from router state — StyleX has no
  // attribute selectors, and `aria-current` is set on the element anyway.
  linkCurrent: { color: color.text, borderBottomColor: color.accent },
  toggle: {
    display: { default: 'none', [NAV]: 'inline-flex' },
    marginInlineStart: 'auto',
    minHeight: 40,
    minWidth: 40,
    paddingBlock: 8,
    paddingInline: 12,
    fontSize: 13,
    fontFamily: font.mono,
    backgroundColor: { default: 'transparent', ':hover': color.surface },
    borderColor: { default: 'transparent', ':hover': color.borderHover },
    borderRadius: radius.md,
  },
  themeToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    marginInlineStart: 14,
    width: { default: 32, [NAV]: 40 },
    height: { default: 32, [NAV]: 40 },
    padding: 0,
    color: { default: color.textDim, ':hover': color.text },
    backgroundColor: { default: 'transparent', ':hover': color.surface },
    borderColor: 'transparent',
    borderRadius: radius.md,
  },
  footer: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
    paddingBlock: 44,
    color: color.textFaint,
    fontSize: 14,
  },
  footerInner: { display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' },
  footerCol: { textAlign: 'right' },
  footerLink: { color: color.textDim, textDecoration: { default: 'none', ':hover': 'underline' } },
  anchor: {
    color: color.accent,
    textDecoration: { default: 'none', ':hover': 'underline' },
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: { default: 0, ':focus-visible': 2 },
    borderRadius: radius.sm,
  },
  skip: {
    position: 'absolute',
    insetInlineStart: { default: -9999, ':focus': 16 },
    insetBlockStart: { default: 'auto', ':focus': 16 },
    zIndex: 100,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    padding: '10px 14px',
    color: color.text,
    textDecoration: 'none',
  },
  extIcon: { marginInlineStart: 5, verticalAlign: '-0.1em' },
})

/** A styled external anchor, for use inside prose. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" {...stylex.props(s.anchor)}>
      {children}
    </a>
  )
}

export function SkipLink() {
  return (
    <a href="#main" {...stylex.props(s.skip)}>
      Skip to content
    </a>
  )
}

function inSection(to: string, pathname: string | null) {
  const base = to.replace(/\/+$/, '') || '/'
  const here = (pathname ?? '/').replace(/\/+$/, '') || '/'
  return here === base || here.startsWith(`${base}/`)
}

function NavLink({
  to,
  label,
  section,
  onNavigate,
}: {
  to: string
  label: string
  section?: boolean
  onNavigate: () => void
}) {
  const exact = useIsCurrent(to)
  const pathname = usePathname()
  const current = exact || (section === true && inSection(to, pathname))
  return (
    <Link
      to={to}
      sx={[s.link, current && s.linkCurrent]}
      onClick={onNavigate}
      aria-current={current ? 'page' : undefined}
    >
      {label}
    </Link>
  )
}

export function Nav() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header {...stylex.props(s.header)}>
      <Wrap sx={s.inner}>
        <Link to="/" sx={s.brand} onClick={() => setOpen(false)}>
          <Mark />
          gpu-components
        </Link>
        <Btn
          sx={s.toggle}
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Close' : 'Menu'}
        </Btn>
        <nav id="site-nav" {...stylex.props(s.links, open && s.linksOpen)} aria-label="Main">
          {ROUTES.map((r) => (
            <NavLink
              key={r.to}
              to={r.to}
              label={r.label}
              section={r.section}
              onNavigate={() => setOpen(false)}
            />
          ))}
          <a
            href="https://vgpu.sh"
            target="_blank"
            rel="noreferrer noopener"
            {...stylex.props(s.link)}
          >
            vgpu
            <span {...stylex.props(util.srOnly)}> (opens in a new tab)</span>
            <ExternalIcon />
          </a>
        </nav>
        <ThemeToggle />
      </Wrap>
    </header>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isLight = theme === 'light'
  return (
    <Btn sx={s.themeToggle} title={isLight ? 'Switch to dark theme' : 'Switch to light theme'} onClick={toggle}>
      <span {...stylex.props(util.srOnly)}>{isLight ? 'Switch to dark theme' : 'Switch to light theme'}</span>
      {isLight ? <MoonIcon /> : <SunIcon />}
    </Btn>
  )
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.4 14.7A8.5 8.5 0 1 1 9.3 3.6a7 7 0 0 0 11.1 11.1Z"
      />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" {...stylex.props(s.extIcon)}>
      <path
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 2.5H2.75A1.25 1.25 0 0 0 1.5 3.75v5.5A1.25 1.25 0 0 0 2.75 10.5h5.5A1.25 1.25 0 0 0 9.5 9.25V7.5M7 1.5h3.5V5M6.5 5.5 10.5 1.5"
      />
    </svg>
  )
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true" {...stylex.props(s.mark)}>
      <rect width="32" height="32" rx="7" fill={color.surface2} />
      <rect x="6" y="9" width="20" height="3" rx="1.5" fill={color.accent} />
      <rect x="6" y="14.5" width="13" height="3" rx="1.5" fill={color.mint} />
      <rect x="6" y="20" width="17" height="3" rx="1.5" fill={color.accent} opacity="0.55" />
    </svg>
  )
}

export function Footer() {
  return (
    <footer {...stylex.props(s.footer)}>
      <Wrap sx={s.footerInner}>
        <Stack gap={8}>
          <span {...stylex.props(typo.mono, typo.bodyInline)}>gpu-components</span>
          <Small>
            In active development · playground live · MIT (intended) · built on{' '}
            <A href="https://vgpu.sh">vgpu</A>
          </Small>
        </Stack>
        <Stack gap={8} sx={s.footerCol}>
          <Link to="/start" sx={s.footerLink}>
            Get started
          </Link>
        </Stack>
      </Wrap>
    </footer>
  )
}
