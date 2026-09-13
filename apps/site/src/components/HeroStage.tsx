'use client'

/* Hallmark · component: hero (H7 demo-clipped-by-viewport-edge) · genre: modern-minimal
 * theme: site system (light · Geist · ink-blue accent) · pre-emit critique: P4 H4 E5 S5 R4 V4
 */

import { useEffect, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { GPUProvider, useGpu } from '@gpu-components/react'
import { PROVIDER_OPTIONS } from './demos/chrome'
import { HeroMiniatures } from './HeroMiniatures'
import { color, radius, shadow, size } from '../tokens.stylex'

/**
 * The landing page's single `<GPUProvider>`, hoisted here so the Showcase's four panels share one
 * runtime. The alternative — a provider in each — is precisely the failure mode the page mocks two
 * sections down ("six GPU panels on a page means six GPU devices"), and shipping it on our own
 * landing page would be the kind of thing someone screenshots.
 *
 * A server component can hand its subtree to this client component as `children`, so the whole
 * page body rides inside without anything else becoming a client component.
 */
export function LandingGpu({ children }: { children: ReactNode }) {
  return <GPUProvider options={PROVIDER_OPTIONS}>{children}</GPUProvider>
}

/** Inlined rather than shared — see `src/ui.tsx`'s equivalent comment. Kept in sync with
 * `HERO_WIDTH_QUERY` below, which needs the same breakpoint as a JS media query rather than CSS. */
const HERO = '@media (max-width: 940px)'
const HERO_WIDTH_QUERY = '(max-width: 940px)'

/** JS-side mirror of the `HERO` CSS breakpoint (PLAN's fallback ladder needs to decide, in JS,
 * whether to mount a real GPU component at all — a canvas hidden by CSS below the breakpoint would
 * still cost a live `GPUDevice` surface, which is exactly the "six GPU panels means six GPU
 * devices" failure mode `LandingGpu`'s own doc comment mocks). `false` on the server and until the
 * first client effect runs, matching `HeroMiniatures`' own SSR-safe default (no flash: the
 * miniatures render immediately either way — see the status branch in `HeroStage` below). */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(HERO_WIDTH_QUERY)
    setNarrow(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/** PLAN's fallback-ladder gate, factored out so `HeroJourney.tsx` (Phase 3's sticky wrapper) can
 * decide — without duplicating it — whether to mount the sticky 3D layer at all: the same "real
 * WebGPU and at/above the `HERO` breakpoint" test `HeroStage` already used inline. */
export function useHero3DActive(): boolean {
  const { status } = useGpu()
  const narrow = useNarrowViewport()
  return status === 'ready' && !narrow
}

/**
 * The hero's stage. Three states (PLAN's fallback ladder, Phase 2):
 *
 * - `status === 'ready'` (real WebGPU) and at/above the `HERO` breakpoint → the real 3D hero
 *   (`Hero3D`, `hero3d/Hero3DComponent.ts`) — 4-6 translucent instanced-quad planes at depth,
 *   riding this page's shared `LandingGpu` runtime.
 * - Otherwise (`'fallback'`/`'unsupported'`/`'pending'`, or a narrow viewport) → all 17 registry
 *   components as hand-drawn vector miniatures (`HeroMiniatures`), inside the tilted,
 *   viewport-clipped panel the live demo used. `'pending'` renders this branch too — `status`
 *   starts `'pending'` on every load (`GPUProvider`'s `PENDING` constant) and there is no loading
 *   spinner or blank state: `HeroMiniatures` is presentable immediately (SSR-safe), and the 3D hero
 *   replaces it the moment the runtime resolves to `'ready'`, same convention `TimelineStage`'s
 *   `status === 'ready'` gate uses in `Showcase.tsx`.
 *
 * The CSS 3D transform (`perspective()`/`rotateX/Y()` on `s.stage`) is dropped specifically for the
 * 3D hero: a transform on a canvas rasterizes it flat and then skews *that raster*, fighting the
 * real WebGPU perspective already baked into the scene and blurring on high-DPR screens. It stays
 * for the `HeroMiniatures` branch, where it is the only source of the product-shot tilt.
 *
 * `prefers-reduced-motion` has no branch here yet (see `hero3d/usePrefersReducedMotion.ts`'s doc
 * comment) — this phase has no animation to suppress, so it would collapse to this same static
 * render either way.
 *
 * Phase 3: when `use3D`, the canvas no longer mounts here at all — `HeroJourney.tsx` promotes it
 * to a `position: sticky` layer spanning this section through "Zoom is a uniform write", behind
 * the actual page content (`page.tsx` wraps the relevant sections in `<HeroJourney>`). This grid
 * cell renders nothing for that branch (the sticky layer shows through the empty column) rather
 * than the bounded, tilted `figure`/`stage`, which stays exactly as-is for the `HeroMiniatures`
 * fallback — a static image still wants its own bounded panel, not a page-spanning sticky rig.
 */
export function HeroStage() {
  const use3D = useHero3DActive()

  if (use3D) return null

  return (
    <figure {...stylex.props(s.figure)}>
      <div {...stylex.props(s.stage)}>
        <HeroMiniatures />
      </div>
    </figure>
  )
}

const s = stylex.create({
  figure: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    margin: 0,
    minWidth: 0,
  },
  /**
   * The clip is the design: the stage's right edge runs past the viewport so the surface reads as
   * continuing beyond the frame — which is the product's actual claim about data and viewports.
   * The margin walks out of the `Wrap` (gutter + centering excess) and overshoots by 56px; the
   * hero section's `overflow: hidden` does the clipping, so the page never scrolls sideways.
   *
   * Below the breakpoint the clip drops entirely — a cut-off image at 375px reads as broken, not
   * intentional.
   */
  stage: {
    position: 'relative',
    height: { default: 500, [HERO]: 320 },
    marginInlineEnd: {
      default: `calc(-1 * (${size.gutter} + max(0px, (100vw - ${size.maxWidth}) / 2) + 96px))`,
      [HERO]: 0,
    },
    /**
     * The 3D product-shot tilt: origin on the left edge so the near side stays large and crisp
     * next to the headline while the far side recedes into the viewport cut — the perspective and
     * the clip tell the same story, a surface bigger than its frame. Dropped along with the clip
     * below the breakpoint, where a tilted cut-off panel reads as broken rather than deliberate.
     */
    transform: {
      default: 'perspective(1600px) rotateX(6deg) rotateY(-13deg) rotateZ(1.5deg)',
      [HERO]: 'none',
    },
    transformOrigin: 'left center',
    backgroundColor: color.bgRaised,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    boxShadow: { default: shadow.lg, [HERO]: shadow.md },
    overflow: 'hidden',
    pointerEvents: 'none',
  },
})
