'use client'

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * `true` once the browser confirms `prefers-reduced-motion: reduce`; `false` on the server and
 * until that first effect runs (SSR-safe — this phase's hero has no animation to suppress either
 * way, so a one-render flash from `false` to `true` on a reduced-motion device changes nothing
 * visible yet).
 *
 * Phase 1+2 has no reveal animation, so nothing branches on this today (per the approved plan:
 * "this likely collapses to the same static render either way"). It exists now so Phase 3's reveal
 * animation — which WILL need to skip straight to the settled state for a reduced-motion visitor —
 * has this plumbing ready rather than needing to invent it under a later deadline.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    setReduced(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
