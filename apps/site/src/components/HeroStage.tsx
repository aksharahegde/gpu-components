'use client'

/* Hallmark · component: hero (H7 demo-clipped-by-viewport-edge) · genre: modern-minimal
 * theme: site system (light · Geist · ink-blue accent) · pre-emit critique: P4 H4 E5 S5 R4 V4
 */

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { GPUProvider } from '@gpuc/react'
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

/** Inlined rather than shared — see `src/ui.tsx`'s equivalent comment. */
const HERO = '@media (max-width: 940px)'

/**
 * The hero's stage: all 17 registry components as hand-drawn vector miniatures
 * (`HeroMiniatures`), inside a tilted, viewport-clipped panel.
 */
export function HeroStage() {
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
