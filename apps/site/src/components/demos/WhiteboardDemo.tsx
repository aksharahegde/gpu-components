'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUWhiteboard, ingestWhiteboard, type WhiteboardShape } from '../../../../../registry/whiteboard'
import { fmtInt, s, useMeasuredStage } from './chrome'

function buildBoard() {
  const shapes: WhiteboardShape[] = [
    { id: 'r1', kind: 'rect', x: -6, y: -3, w: 3, h: 2, color: 0 },
    { id: 'r2', kind: 'rect', x: 4, y: 1, w: 2.5, h: 2.5, color: 3 },
    { id: 'e1', kind: 'ellipse', x: -1, y: 4, w: 3, h: 2, color: 2 },
    { id: 'ruler1', kind: 'ruler', x0: -6, y0: 0, x1: 6, y1: 0, color: 6 },
    {
      id: 'poly1',
      kind: 'polygon',
      points: [
        { x: -3, y: -6 },
        { x: 0, y: -8 },
        { x: 3, y: -6 },
        { x: 1.5, y: -3 },
        { x: -1.5, y: -3 },
      ],
      color: 4,
    },
    {
      id: 'free1',
      kind: 'freehand',
      points: Array.from({ length: 24 }, (_, i) => {
        const t = i / 23
        return { x: 6 + t * 6, y: -4 + Math.sin(t * Math.PI * 2) * 1.5 }
      }),
      color: 1,
    },
    { id: 'p1', kind: 'point', x: 0, y: 0, color: 5 },
  ]
  return ingestWhiteboard(shapes)
}

function WhiteboardStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 960, height: 520 })

  const data = useMemo(() => buildBoard(), [])
  const [hovered, setHovered] = useState<string | null>(null)

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: data.bounds.xMin,
    timeEnd: data.bounds.xMax,
    trackCount: 1,
    rowStart: data.bounds.yMin,
    rowEnd: data.bounds.yMax,
    yContinuous: true,
    width: box.width,
    height: box.height,
  }))

  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>GPUWhiteboard — {fmtInt(data.shapes.length)} shapes</span>
        <span {...stylex.props(s.readoutValue)}>
          {hovered ?? <span {...stylex.props(s.dim)}>hover a shape</span>}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUWhiteboard
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredId={hovered}
            onHover={setHovered}
            aria-label="Whiteboard"
          />
        )}
      </div>
      <p {...stylex.props(s.footnote)}>
        Today: pan, zoom, and exact CPU hover over a static board — shapes forked from
        GPUAnnotationCanvas, background is a procedural dot-grid with no geometry of its own.
        Drawing tools, select/move and multi-select are next.
      </p>
    </div>
  )
}

const PROVIDER_OPTIONS = { profiling: true }

export function WhiteboardDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <WhiteboardStage />
    </GPUProvider>
  )
}
