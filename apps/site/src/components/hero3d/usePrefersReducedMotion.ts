'use client'

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * `true` when the browser reports `prefers-reduced-motion: reduce`; `false` when unknown (SSR) or
 * not reduced.
 *
 * Phase 3 wires this up for real: `Hero3D.tsx` passes it into `Hero3DComponent.update()`, which
 * must mount directly into the settled pose (no 1.2s reveal, no parallax, no scroll collapse) for a
 * reduced-motion visitor — not "the real animation, held still mid-flight." That means the value
 * has to be correct by this component's *first* render, not one tick later: `Hero3D` only exists
 * as a client component mounted after hydration (nothing about it is server-rendered), so reading
 * `matchMedia` directly in the `useState` initializer is safe here — unlike a component whose first
 * client render must match server-rendered markup, there's no SSR output to diff against for a
 * canvas that only exists once `useCanvasRef`'s ref callback has run. The effect below still
 * listens for a live OS-level change while mounted.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    setReduced(mql.matches) // catches any change between the lazy init above and this effect
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
