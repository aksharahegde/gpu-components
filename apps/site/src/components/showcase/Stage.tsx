'use client'

import { type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useGpu } from '@gpuc/react'
import { useMeasuredStage } from '../demos/chrome'

const s = stylex.create({
  stageBox: { position: 'absolute', inset: 0 },
})

/**
 * Shared shell for the four Showcase stages: measures its box and renders nothing until the
 * runtime is up and the element has a real width, which every registry component requires (they
 * size from `viewport.width/height` rather than observing their own canvas — PLAN.md §11.1).
 */
export function Stage({
  children,
}: {
  children: (box: { width: number; height: number }) => ReactNode
}) {
  const { status } = useGpu()
  const { ref, box } = useMeasuredStage({ width: 520, height: 200 })
  return (
    <div ref={ref} {...stylex.props(s.stageBox)}>
      {status === 'ready' && box.width > 1 && children(box)}
    </div>
  )
}
