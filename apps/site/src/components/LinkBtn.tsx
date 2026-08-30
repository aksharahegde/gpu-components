import type { ReactNode } from 'react'
import { Link } from '../link'
import { button } from '../ui'

/**
 * A router link that looks like a button. Lives here rather than in `ui.tsx`
 * because `ui.tsx` must not depend on the router — the styles flow the other
 * way, which keeps the primitive library route-agnostic.
 */
export function LinkBtn({
  to,
  children,
  primary,
}: {
  to: string
  children: ReactNode
  primary?: boolean
}) {
  return (
    <Link to={to} sx={[button.base, primary && button.primary]}>
      {children}
    </Link>
  )
}
