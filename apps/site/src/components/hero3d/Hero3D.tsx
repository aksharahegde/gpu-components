'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCanvasRef, useGpuComponent } from '@gpu-components/react'
import { Hero3DComponent, type Hero3DProps } from './Hero3DComponent.ts'
import { usePrefersReducedMotion } from './usePrefersReducedMotion.ts'

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
 *
 * `vgpu`'s `surface()` auto-resizes from the canvas's CSS size (`surface.d.ts`: "the surface
 * resizes itself right after the frame clock advances"), so this needs no width/height attributes
 * or `ResizeObserver` of its own — `Hero3DComponent.syncCamera` reacts to that resize by reading
 * `ctx.surface.surface.size` fresh on the next `plan()` call.
 *
 * `aria-hidden`: pure decoration. The hero's real content (heading, lead, CTA) lives in `page.tsx`,
 * unchanged.
 */
export function Hero3D() {
  const [canvas, ref] = useCanvasRef()
  const reducedMotion = usePrefersReducedMotion()
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [scrollCollapse, setScrollCollapse] = useState(0)

  // Reduced motion disables both inputs outright (per the approved plan): no pointer tracking, no
  // scroll sampling loop — `Hero3DComponent.update()` ignores both anyway, but not even attaching
  // the listeners is the honest version of "disabled," not "computed and discarded."
  useEffect(() => {
    if (!canvas || reducedMotion) return

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
          setPointer((prev) => (prev === null ? prev : null))
          if (raf) cancelAnimationFrame(raf)
          raf = 0
        } else if (!raf) {
          raf = requestAnimationFrame(tick)
        }
      },
      { rootMargin: '0px' },
    )
    io.observe(canvas)

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
  }, [canvas, reducedMotion])

  const props = useMemo<Hero3DProps>(
    () => ({
      reducedMotion,
      pointerX: pointer?.x ?? null,
      pointerY: pointer?.y ?? null,
      scrollCollapse,
    }),
    [reducedMotion, pointer, scrollCollapse],
  )
  useGpuComponent(() => new Hero3DComponent(), canvas, props)

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  )
}
