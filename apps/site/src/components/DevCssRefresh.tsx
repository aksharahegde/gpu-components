'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Dev-only fix for a real bug in `next.config.ts`'s StyleX injection: that hack appends
 * newly-*compiled* rules into the one shared `layout.css` asset as `next dev` discovers them
 * route by route (on-demand compilation), but a client-side `<Link>` navigation never re-fetches
 * that `<link>` — the App Router treats global CSS as fixed for the whole session. So the first
 * navigation into any route whose components were not yet compiled (their StyleX classes are
 * genuinely new to `layout.css`) renders against the browser's *stale*, already-cached copy,
 * missing exactly the rules that route needs — reproduced as `GPUTimeline`'s stage measuring
 * `0` height (`Canvas: 1072 × 0` in its own inspector) because the shared `.stage { height: 440 }`
 * rule from `chrome.tsx` hadn't been fetched yet the very first time any playground demo page was
 * visited. A manual reload fixes it because a full page load always re-fetches `layout.css` fresh.
 *
 * Static extraction (not runtime injection) is required at all for Server Component styles — see
 * `next.config.ts`'s own comment — so the fix here is the other half: force the browser to refetch
 * the CSS asset after every client-side route change, bypassing its cache with a query-string
 * bust. The server keeps serving the same on-disk/in-memory path regardless of the query string,
 * so this always gets whatever `next dev` has compiled *as of this navigation* — which, since the
 * RSC payload for the new route cannot have been produced without every component along the way
 * already having been transformed (and StyleX extraction happens at transform time), is always
 * everything the new page needs.
 *
 * A no-op in production: `output: 'export'` pre-compiles every route before any page is ever
 * served, so there is no "not yet compiled" state for a static build to race against, and doing
 * this in production would just be a wasted re-fetch of an identical file on every navigation.
 */
export function DevCssRefresh() {
  const pathname = usePathname()
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    // The initial page load already fetched a fresh copy — only re-fetch on the navigations after it.
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const current = document.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"][href*="/_next/static/css/"]',
    )
    if (!current) return
    const href = current.getAttribute('href')
    if (!href) return

    const url = new URL(href, window.location.origin)
    url.searchParams.set('devrefresh', String(Date.now()))

    const fresh = document.createElement('link')
    fresh.rel = 'stylesheet'
    fresh.href = url.toString()
    // Swap only once the new stylesheet has actually loaded, so there's never a frame with no
    // stylesheet at all between removing the old one and the new one applying.
    fresh.onload = () => current.remove()
    fresh.onerror = () => fresh.remove()
    document.head.appendChild(fresh)
  }, [pathname])

  return null
}
