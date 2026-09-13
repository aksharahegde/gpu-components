'use client'

import { useCanvasRef, useGpuComponent } from '@gpu-components/react'
import { Hero3DComponent } from './Hero3DComponent.ts'

/**
 * The 3D hero's mount point — same convention as every other GPU surface on this page
 * (`useCanvasRef` + `useGpuComponent`, `GPUTimeline.tsx`'s pattern), riding `HeroStage.tsx`'s
 * shared `LandingGpu` provider rather than a provider of its own.
 *
 * No props: the scene is static for this phase (Phase 1+2 — see `Hero3DComponent`'s doc comment).
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
  useGpuComponent(() => new Hero3DComponent(), canvas, {})

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  )
}
