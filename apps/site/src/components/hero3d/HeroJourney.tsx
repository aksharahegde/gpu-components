'use client'

import { useRef, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useHero3DActive } from '../HeroStage'
import { Hero3D } from './Hero3D'

/**
 * Phase 3 of the scroll-journey extension: promotes the 3D hero canvas out of the hero's own
 * bounded grid cell (`HeroStage.tsx`) into a `position: sticky` layer spanning `page.tsx`'s first
 * four sections (hero through "Zoom is a uniform write, not a re-render.") — `page.tsx` wraps
 * exactly that JSX in `<HeroJourney>`, unchanged from Phase 2 otherwise (no copy edits).
 *
 * Structure: one `position: relative` container (`s.journey`, sized by its normal-flow children —
 * the wrapped sections, exactly as before); inside it, the sticky canvas layer (`s.sticky`, low
 * `z-index`) as the first child, and the actual section content as a second child at a higher
 * `z-index` (`s.content`) so headings/copy/cards paint on top and stay fully readable — `Section`
 * has no background of its own (only a hairline top border, `ui.tsx`) and `Card` is opaque
 * `#ffffff`, which is why this works without touching global background or z-index anywhere else:
 * the scene shows through `Section`'s gutters/padding, `Card`'s opaque fill keeps existing text
 * contrast unchanged.
 *
 * `s.content` needs its own `position: relative` to actually win the stacking order: the sticky
 * layer is a *positioned* box, and per CSS's default stacking rules a positioned box paints above
 * unpositioned normal-flow siblings regardless of z-index or DOM order — so the content also has
 * to become a positioned box (with an explicit z-index) for "sections on top" to hold, not just
 * "sections after the canvas in the DOM."
 *
 * `useHero3DActive()` mirrors `HeroStage`'s own fallback-ladder gate: below the `HERO` breakpoint or
 * without real WebGPU, this renders `children` with no sticky rig at all — a static
 * `<HeroMiniatures />` (still rendered by `HeroStage` inside the wrapped hero section) has no
 * business being pinned across four sections, and the plain `<div>` here costs nothing unused.
 */
export function HeroJourney({ children }: { children: ReactNode }) {
  const use3D = useHero3DActive()
  const containerRef = useRef<HTMLDivElement>(null)

  if (!use3D) return <>{children}</>

  return (
    <div ref={containerRef} {...stylex.props(s.journey)}>
      <div {...stylex.props(s.sticky)}>
        <Hero3D journeyContainerRef={containerRef} />
      </div>
      <div {...stylex.props(s.content)}>{children}</div>
    </div>
  )
}

const s = stylex.create({
  journey: {
    position: 'relative',
  },
  /** `100svh`, not `100vh`: mobile browser chrome (address bar) resizes the large viewport as the
   * page scrolls, which would otherwise make a `100vh` sticky layer taller than the actually-stable
   * visible area and jitter against it — `100svh` is the small/stable viewport height, matching
   * what stays visible throughout the scroll. Codebase has no prior viewport-height usage to match
   * (`Chrome.tsx`'s header is `position: sticky` but unsized, relying on content height).
   *
   * `marginBottom: -100svh` is load-bearing, not decoration: `position: sticky` (unlike `fixed`)
   * still occupies its own box in normal flow at its *static* position — a sibling placed after it
   * lays out *below* that box, not on top of it. Without this, `s.content` rendered a full viewport
   * height lower than the sticky canvas, which is exactly why the hero's text was missing from the
   * very first screenshot at scroll 0: the canvas filled the viewport and the actual copy was
   * sitting one `100svh` further down, off-screen until the user scrolled past it. The negative
   * margin cancels the sticky box's contribution to flow height so `s.content` starts at the same
   * flow position as the sticky layer's top, letting `z-index` actually do the overlap job the
   * comment above already assumed it was doing. */
  sticky: {
    position: 'sticky',
    top: 0,
    height: '100svh',
    marginBottom: 'calc(-1 * 100svh)',
    zIndex: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  content: {
    position: 'relative',
    zIndex: 1,
  },
})
