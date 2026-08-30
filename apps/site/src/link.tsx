'use client'

import NextLink from 'next/link'
import { usePathname } from 'next/navigation'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { SX } from './ui'

/**
 * Thin wrapper around `next/link` that keeps the `Link`/`useIsCurrent` API the
 * rest of the site already uses (StyleX `sx` prop, `aria-current`). Client
 * navigation, prefetch, and modified-click passthrough are all `next/link`'s.
 */

function normalise(p: string): string {
  const clean = p.replace(/\/+$/, '')
  return clean === '' ? '/' : clean
}

export function useIsCurrent(to: string) {
  const pathname = usePathname()
  return normalise(to) === normalise(pathname ?? '/')
}

export function Link({
  to,
  children,
  sx,
  onClick,
  ...rest
}: {
  to: string
  children: ReactNode
  sx?: SX
  onClick?: () => void
} & { 'aria-label'?: string; title?: string }) {
  const isCurrent = useIsCurrent(to)
  const isHash = to.startsWith('#')

  return (
    <NextLink
      href={to}
      aria-current={isCurrent && !isHash ? 'page' : undefined}
      onClick={onClick}
      {...stylex.props(sx)}
      {...rest}
    >
      {children}
    </NextLink>
  )
}
