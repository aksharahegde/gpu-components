'use client'

import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpuc/react'
import type { ViewportState } from '@gpuc/core'
import {
  GPUWhiteboard,
  ingestWhiteboard,
  type WhiteboardShape,
  type WhiteboardTool,
} from '../../../../../registry/whiteboard'
import { Btn, Dim, Field, fmtInt, Hint, Panel, PROVIDER_OPTIONS, Readout, s, Segmented, useMeasuredStage } from './chrome'

const TOOLS: readonly WhiteboardTool[] = ['select', 'rect', 'ellipse', 'point', 'ruler', 'polygon', 'freehand']

function seedShapes(): WhiteboardShape[] {
  return [
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
}

function WhiteboardStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 960, height: 520 })

  const [shapes, setShapes] = useState<WhiteboardShape[]>(seedShapes)
  const data = useMemo(() => ingestWhiteboard(shapes), [shapes])
  const [hovered, setHovered] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [tool, setTool] = useState<WhiteboardTool>('select')

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

  const onCreate = useCallback((shape: WhiteboardShape) => {
    setShapes((prev) => [...prev, shape])
  }, [])

  const onChange = useCallback((shape: WhiteboardShape) => {
    setShapes((prev) => prev.map((s2) => (s2.id === shape.id ? shape : s2)))
  }, [])

  const onDelete = useCallback((ids: readonly string[]) => {
    const removed = new Set(ids)
    setShapes((prev) => prev.filter((s2) => !removed.has(s2.id)))
  }, [])

  const resetShapes = useCallback(() => {
    setShapes(seedShapes())
    setSelectedIds(new Set())
  }, [])

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.controls)}>
        <Field label="Tool">
          <Segmented options={TOOLS} value={tool} onChange={setTool} />
        </Field>
        <Btn onClick={resetShapes}>Reset shapes</Btn>
      </div>

      <p {...stylex.props(s.blurb)}>
        Shapes are a host-owned array — this page's state decides whether to keep whatever a draw
        tool, a move-drag, or a delete asks for. Select reuses GPUNodeEditor's shift-click/marquee
        pattern; the six draw tools reuse GPUAnnotationCanvas's pointer-lifecycle machine.
      </p>

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
            tool={tool}
            hoveredId={hovered}
            onHover={setHovered}
            onSelectionChange={setSelectedIds}
            onCreate={onCreate}
            onChange={onChange}
            onDelete={onDelete}
            aria-label="Whiteboard"
          />
        )}
      </div>

      <div {...stylex.props(s.hints)}>
        <Hint keys="drag">pan (select tool, empty space), or draw with the active tool</Hint>
        <Hint keys="click / shift+click">select a shape / add it to the selection</Hint>
        <Hint keys="shift+drag">marquee-select every shape it touches</Hint>
        <Hint keys="drag a selection">move it</Hint>
        <Hint keys="ctrl + wheel">zoom at the cursor</Hint>
        <Hint keys="dblclick / Enter">close a polygon</Hint>
        <Hint keys="Esc">cancel the in-progress draft</Hint>
        <Hint keys="Delete">remove the selection</Hint>
      </div>

      <Panel title="Selection">
        <Readout label="Selected">
          {selectedIds.size > 0 ? `${fmtInt(selectedIds.size)} shape${selectedIds.size === 1 ? '' : 's'}` : <Dim>none</Dim>}
        </Readout>
      </Panel>

      <p {...stylex.props(s.footnote)}>
        Background is a procedural dot-grid with no geometry of its own; rect/ellipse/point are one
        quad each via <code>InstancedQuadLayer</code>, ruler/polygon/freehand are edges via{' '}
        <code>LineLayer</code> — forked from GPUAnnotationCanvas.
      </p>
    </div>
  )
}

export function WhiteboardDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <WhiteboardStage />
    </GPUProvider>
  )
}
