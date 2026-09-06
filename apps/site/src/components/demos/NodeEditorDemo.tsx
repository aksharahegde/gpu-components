'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUNodeEditor, ingestNodeEditor } from '../../../../../registry/nodeeditor'
import { fmtInt, Hint, PROVIDER_OPTIONS, s, useMeasuredStage } from './chrome'

function buildPipeline() {
  return ingestNodeEditor({
    nodes: [
      { id: 'src', label: 'HTTP Source', x: 0, y: 0.5, width: 1.8, height: 1, category: 0 },
      { id: 'parse', label: 'Parse JSON', x: 3, y: -0.6, width: 1.8, height: 1, category: 1 },
      { id: 'validate', label: 'Validate', x: 3, y: 1.6, width: 1.8, height: 1, category: 1 },
      { id: 'enrich', label: 'Enrich', x: 6, y: 0.5, width: 1.8, height: 1, category: 1 },
      { id: 'filter', label: 'Filter', x: 9, y: -0.6, width: 1.8, height: 1, category: 2 },
      { id: 'dedupe', label: 'Dedupe', x: 9, y: 1.6, width: 1.8, height: 1, category: 2 },
      { id: 'sink', label: 'Write Sink', x: 12, y: 0.5, width: 1.8, height: 1, category: 0 },
    ],
    edges: [
      { source: 0, target: 1 },
      { source: 0, target: 2 },
      { source: 1, target: 3 },
      { source: 2, target: 3 },
      { source: 3, target: 4 },
      { source: 3, target: 5 },
      { source: 4, target: 6 },
      { source: 5, target: 6 },
    ],
  })
}

function NodeEditorStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 960, height: 520 })

  const data = useMemo(() => buildPipeline(), [])
  const [hovered, setHovered] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ nodes: ReadonlySet<number>; edges: ReadonlySet<number> }>({
    nodes: new Set(),
    edges: new Set(),
  })
  const [lastEvent, setLastEvent] = useState<string | null>(null)

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

  const hoverLabel = hovered != null ? data.labels[hovered] : null
  const selectionLabel =
    selection.nodes.size + selection.edges.size === 0
      ? null
      : `${selection.nodes.size} node${selection.nodes.size === 1 ? '' : 's'}, ${selection.edges.size} edge${selection.edges.size === 1 ? '' : 's'} selected`

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>
          GPUNodeEditor — {fmtInt(data.nodeCount)} nodes, {fmtInt(data.edgeCount)} connections
        </span>
        <span {...stylex.props(s.readoutValue)}>
          {lastEvent ?? selectionLabel ?? hoverLabel ?? <span {...stylex.props(s.dim)}>drag a node or a port</span>}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUNodeEditor
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredNode={hovered}
            onHoverNode={setHovered}
            onSelectionChange={(nodes, edges) => setSelection({ nodes, edges })}
            onNodeMove={(index, x, y) => setLastEvent(`moved ${data.labels[index]} to (${x.toFixed(1)}, ${y.toFixed(1)})`)}
            onConnect={(source, target) => setLastEvent(`connected ${data.labels[source]} → ${data.labels[target]}`)}
            onDelete={(nodes, edges) => setLastEvent(`deleted ${nodes.length} node(s), ${edges.length} edge(s)`)}
            aria-label="Pipeline node editor"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="drag node">move</Hint>
        <Hint keys="drag port">connect</Hint>
        <Hint keys="shift+click">multi-select</Hint>
        <Hint keys="shift+drag">marquee-select</Hint>
        <Hint keys="delete">remove selection</Hint>
        <Hint keys="wheel">zoom</Hint>
        <Hint keys="drag canvas">pan</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        Positions, connections and deletions all live on the CPU and are mutated in place — the GPU
        only draws instanced node boxes, ports and lines from whatever that state currently is.
      </p>
    </div>
  )
}

export function NodeEditorDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <NodeEditorStage />
    </GPUProvider>
  )
}
