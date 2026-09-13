'use client'

import { useEffect, useMemo, useState, type RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useCanvasRef, useGpu, useGpuComponent } from '@gpu-components/react'
import type { SurfaceOptions } from 'vgpu'
import { Hero3DComponent, type Hero3DProps } from './Hero3DComponent.ts'
import { usePrefersReducedMotion } from './usePrefersReducedMotion.ts'
import { WAYPOINT_READOUT, WAYPOINTS } from './data.ts'
import { color, font } from '../../tokens.stylex'

/** Below this viewport width the DPR cap tightens from 2 to 1.5 (Phase 5 budget: bounds the
 * canvas's backing-store resolution, and so its fill-rate cost, on the small viewports where a
 * full 2x backing store buys the least visible sharpness). Matches `useGpuCanvas.ts`'s note that
 * `SurfaceOptions` is read once at first registration — this reads `window` at mount time, not
 * reactively, which is fine: nobody resizes past this breakpoint mid-session in practice, and a
 * full remount is what every other one-time surface option here already assumes. */
const NARROW_VIEWPORT_PX = 900

/** How close to unchanged a pointer/scroll reading has to be to skip a state update — small enough
 * to be visually invisible, big enough that idle jitter (mouse resting, no real scroll) doesn't
 * cause a React re-render every animation frame. */
const CHANGE_EPSILON = 0.002

/**
 * The 3D hero's mount point — same convention as every other GPU surface on this page
 * (`useCanvasRef` + `useGpuComponent`, `GPUTimeline.tsx`'s pattern), riding `HeroStage.tsx`'s
 * shared `LandingGpu` provider rather than a provider of its own.
 *
 * Phase 3 adds three host-side inputs, all funneled into `Hero3DComponent.update()` — the
 * component owns the actual easing (reveal timing, pointer damping); this wrapper's only job is
 * reporting current pointer position and scroll collapse, and only while it's worth reporting:
 *
 * - `reducedMotion`: `usePrefersReducedMotion()`, unconditional.
 * - `pointerX`/`pointerY`: normalized position within the canvas, tracked via a `window`-level
 *   `pointermove` (the canvas itself is `pointerEvents: 'none'` — see `HeroStage.tsx` — so it can
 *   never receive its own pointer events) sampled once per animation frame, and only while the
 *   hero is intersecting the viewport at all.
 * - `scrollCollapse`: read from `getBoundingClientRect()` against `IntersectionObserver`, per the
 *   approved plan (`Showcase.tsx`'s lazy-mount observer is the closest existing convention, though
 *   this one can't be a one-way latch — scrolling back up must un-collapse). The sampling loop
 *   stops entirely the moment the hero is no longer intersecting, per the plan's cost discipline.
 *   Now that `HeroJourney.tsx` makes this canvas `position: sticky`, this rect naturally reads 0
 *   the whole time the canvas is pinned (a stuck sticky element's own rect top sits at its `top`
 *   offset, 0) and only starts climbing once the journey container's end pushes it back into
 *   normal flow — i.e. it now fires exactly during the sticky-exit at the *end* of the journey,
 *   which is the effect it was always for (fading the scene flat as it scrolls away), not a
 *   placeholder anymore.
 * - `journeyT`: 0 at the top of the journey container, 1 at its bottom — read from the *container*
 *   `HeroJourney.tsx` passes down as `journeyContainerRef`, not the canvas (the canvas's own rect
 *   stays pinned at `top: 0` for virtually the whole journey once sticky, so it can't be the
 *   source for a value that's supposed to move smoothly across four sections). Sampled in the same
 *   tick as `scrollCollapse`/pointer — one loop, three derived values, per the plan's "extend, don't
 *   duplicate" instruction.
 *
 * `vgpu`'s `surface()` auto-resizes from the canvas's CSS size (`surface.d.ts`: "the surface
 * resizes itself right after the frame clock advances"), so this needs no width/height attributes
 * or `ResizeObserver` of its own — `Hero3DComponent.syncCamera` reacts to that resize by reading
 * `ctx.surface.surface.size` fresh on the next `plan()` call.
 *
 * `aria-hidden`: pure decoration. The hero's real content (heading, lead, CTA) lives in `page.tsx`,
 * unchanged.
 */
export function Hero3D({
  journeyContainerRef,
}: {
  /** The Phase 3 journey container (`HeroJourney.tsx`) whose bounding rect `journeyT` is derived
   * from. Optional only so this component still degrades to something sane if ever mounted without
   * the wrapper (`journeyT` falls back to `scrollCollapse`, Phase 1's original placeholder range) —
   * in practice `HeroJourney` always passes one. */
  journeyContainerRef?: RefObject<HTMLDivElement | null>
}) {
  const [canvas, ref] = useCanvasRef()
  const reducedMotion = usePrefersReducedMotion()
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [scrollCollapse, setScrollCollapse] = useState(0)
  const [journeyT, setJourneyT] = useState(0)

  // Reduced motion disables both inputs outright (per the approved plan): no pointer tracking, no
  // scroll sampling loop — `Hero3DComponent.update()` ignores both anyway, but not even attaching
  // the listeners is the honest version of "disabled," not "computed and discarded."
  useEffect(() => {
    if (!canvas || reducedMotion) return

    // Gate the loop on the journey container when there is one — it spans four sections, so it
    // stays "intersecting" (and the loop keeps sampling) across the whole range the canvas is
    // pinned for, not just whatever sliver of the canvas's own (now sticky, mostly-0-rect) box
    // happens to overlap the viewport. Falls back to the canvas itself when unmounted bare.
    const observedEl = journeyContainerRef?.current ?? canvas

    let intersecting = false
    let raf = 0
    const pointerPos = { x: 0, y: 0 }
    let hasPointer = false

    const tick = () => {
      raf = intersecting ? requestAnimationFrame(tick) : 0
      if (!intersecting) return

      const rect = canvas.getBoundingClientRect()
      const collapse = rect.top < 0 ? Math.min(1, -rect.top / Math.max(1, rect.height)) : 0
      setScrollCollapse((prev) => (Math.abs(prev - collapse) > CHANGE_EPSILON ? collapse : prev))

      const container = journeyContainerRef?.current
      if (container) {
        const crect = container.getBoundingClientRect()
        // 0 when the container's top just reached the viewport top (sticky pin begins), 1 when its
        // bottom has scrolled up to the viewport bottom (sticky pin ends) — the exact span a
        // `position: sticky; top: 0` child spends pinned inside a taller parent.
        const span = Math.max(1, crect.height - window.innerHeight)
        const t = Math.min(1, Math.max(0, -crect.top / span))
        setJourneyT((prev) => (Math.abs(prev - t) > CHANGE_EPSILON ? t : prev))
      } else {
        setJourneyT((prev) => (Math.abs(prev - collapse) > CHANGE_EPSILON ? collapse : prev))
      }

      if (!hasPointer) {
        setPointer((prev) => (prev === null ? prev : null))
        return
      }
      const x = ((pointerPos.x - rect.left) / rect.width) * 2 - 1
      const y = ((pointerPos.y - rect.top) / rect.height) * 2 - 1
      const inside = x >= -1 && x <= 1 && y >= -1 && y <= 1
      setPointer((prev) => {
        if (!inside) return prev === null ? prev : null
        if (prev && Math.abs(prev.x - x) < CHANGE_EPSILON && Math.abs(prev.y - y) < CHANGE_EPSILON) return prev
        return { x, y }
      })
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        intersecting = entry?.isIntersecting ?? false
        if (!intersecting) {
          // Fully out of view: freeze at whichever edge it exited through and stop all sampling —
          // nobody can see this canvas, so there is nothing left to compute.
          const rect = canvas.getBoundingClientRect()
          setScrollCollapse(rect.top < 0 ? 1 : 0)
          setJourneyT(rect.top < 0 ? 1 : 0)
          setPointer((prev) => (prev === null ? prev : null))
          if (raf) cancelAnimationFrame(raf)
          raf = 0
        } else if (!raf) {
          raf = requestAnimationFrame(tick)
        }
      },
      { rootMargin: '0px' },
    )
    io.observe(observedEl)

    const onPointerMove = (event: PointerEvent) => {
      pointerPos.x = event.clientX
      pointerPos.y = event.clientY
      hasPointer = true
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })

    return () => {
      io.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [canvas, reducedMotion, journeyContainerRef])

  const props = useMemo<Hero3DProps>(
    () => ({
      reducedMotion,
      pointerX: pointer?.x ?? null,
      pointerY: pointer?.y ?? null,
      scrollCollapse,
      journeyT,
    }),
    [reducedMotion, pointer, scrollCollapse, journeyT],
  )
  // DPR cap (Phase 5 budget): `vgpu`'s `surface()` reads raw `devicePixelRatio` for the canvas's
  // backing-store resolution unless told otherwise — uncapped, that's 3x+ on modern phones for a
  // decorative background nobody is inspecting pixel-by-pixel. Same clamp pattern as
  // `GPUDataGrid`/`GPUSpreadsheet`'s `Math.min(2, devicePixelRatio)`, just handed to the surface
  // itself (this component draws straight to the GPU surface, no 2D overlay canvas of its own).
  const surfaceOpts = useMemo<SurfaceOptions>(() => {
    const cap = typeof window !== 'undefined' && window.innerWidth < NARROW_VIEWPORT_PX ? 1.5 : 2
    const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    return { dpr: Math.min(raw, cap) }
  }, [])
  useGpuComponent(() => new Hero3DComponent(), canvas, props, surfaceOpts)

  return (
    <>
      <canvas
        ref={ref}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      <ReadoutRail journeyT={journeyT} />
    </>
  )
}

/**
 * Phase 4 of the extension plan: a live perf rail replacing decorative sci-fi flavor text with
 * real, checkable numbers — this product's whole voice (PRODUCT.md: "credible, measured,
 * anti-hype"). Three lines: a fixed product label, the current waypoint's name + a derived
 * instance count (`WAYPOINT_READOUT` in `data.ts`, computed from the same constants each layer
 * loops over — never a separate magic number), and a live CPU-encode/submit readout polled the
 * same way `Showcase.tsx`'s caption does (500ms `setInterval` against `profiler.lastFrame`, which
 * `packages/core/src/profiler.ts` documents as "always populated" — free to collect, no new GPU
 * work). Labeled "CPU ENCODE", matching `GpuInspector.ts`'s own precedent, so it can't be misread
 * as total frame time.
 *
 * `journeyT` is already sampled by this component's own scroll-tracking effect above, so the
 * "current waypoint" lookup reuses that rather than re-deriving scroll position independently.
 * `aria-hidden`: ambient decoration — the page's real claims live in the prose copy, not here.
 */
function ReadoutRail({ journeyT }: { journeyT: number }) {
  const { runtime } = useGpu()
  const [frame, setFrame] = useState<{ cpuMs: number; passCount: number } | null>(null)

  useEffect(() => {
    if (!runtime) return
    const id = setInterval(() => {
      const f = runtime.profiler.lastFrame
      if (f) setFrame({ cpuMs: f.cpuMs, passCount: f.passCount })
    }, 500)
    return () => clearInterval(id)
  }, [runtime])

  const waypointIndex = Math.min(
    WAYPOINT_READOUT.length - 1,
    Math.round(journeyT * (WAYPOINTS.length - 1)),
  )
  const waypoint = WAYPOINT_READOUT[waypointIndex]!

  return (
    <div {...stylex.props(s.rail)} aria-hidden="true">
      <span {...stylex.props(s.railLine)}>GPU-COMPONENTS</span>
      <span {...stylex.props(s.railLine)}>
        {waypoint.name} · {waypoint.count}
      </span>
      <span {...stylex.props(s.railLine)}>
        {frame
          ? `${frame.cpuMs.toFixed(2)} MS CPU ENCODE · ${frame.passCount} PASS${frame.passCount === 1 ? '' : 'ES'}`
          : '—'}
      </span>
    </div>
  )
}

/**
 * Below this, `Wrap`'s content (`tokens.stylex.ts`: `maxWidth: 1120px`, `gutter: 24px`) runs
 * edge-to-edge with only the 24px gutter as margin — nowhere near this rail's ~190px of nowrap
 * text. Rather than let the rail collide with (and get partly occluded by, since section cards
 * sit at a higher z-index — `HeroJourney.tsx`'s doc comment) the section cards, it simply doesn't
 * render below the width where a real empty margin opens up: `(100vw - 1120px) / 2` needs to clear
 * the rail's own width plus a gutter-sized buffer, which happens around 1400px of viewport width.
 */
const RAIL_TOO_NARROW = '@media (max-width: 1399px)'

const s = stylex.create({
  rail: {
    position: 'absolute',
    right: 20,
    top: '50%',
    transform: 'translateY(-50%)',
    display: { default: 'flex', [RAIL_TOO_NARROW]: 'none' },
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: 200,
    pointerEvents: 'none',
  },
  railLine: {
    fontFamily: font.mono,
    fontSize: 10.5,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    textAlign: 'right',
    color: color.textFaint,
    whiteSpace: 'nowrap',
  },
})
