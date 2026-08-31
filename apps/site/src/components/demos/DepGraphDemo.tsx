'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUDepGraph, ingestDepGraph } from '../../../../../registry/depgraph'
import { Hint, fmtInt, mulberry32, s, useMeasuredStage } from './chrome'

const SCOPES = ['app', 'core', 'ui', 'api', 'db', 'auth', 'util', 'cli', 'web', 'worker'] as const
const KINDS = ['pkg', 'lib', 'mod', 'svc'] as const

function buildPackageDag(nodeCount: number, seed = 0xde09) {
  const rnd = mulberry32(seed)
  const nodes = Array.from({ length: nodeCount }, (_, i) => {
    const scope = SCOPES[i % SCOPES.length]!
    const kind = KINDS[(i * 3) % KINDS.length]!
    return {
      id: `${scope}/${kind}-${i}`,
      label: `${scope}/${kind}-${i}`,
      category: i % 6,
    }
  })

  const edges: { source: number; target: number }[] = []
  const seen = new Set<string>()
  const push = (source: number, target: number) => {
    if (source === target) return
    const key = `${source}>${target}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source, target })
  }

  // Layered forward edges (mostly a DAG).
  for (let i = 0; i < nodeCount; i++) {
    const fan = 1 + Math.floor(rnd() * 3)
    for (let k = 0; k < fan; k++) {
      const span = 1 + Math.floor(rnd() * 12)
      const target = i + span
      if (target < nodeCount) push(i, target)
    }
  }

  // A handful of intentional cycles so back-edges show up.
  const cycleBudget = Math.max(4, Math.floor(nodeCount / 80))
  for (let c = 0; c < cycleBudget; c++) {
    const a = Math.floor(rnd() * (nodeCount - 20))
    const b = a + 5 + Math.floor(rnd() * 15)
    push(a, b)
    push(b, a)
  }

  return ingestDepGraph({ nodes, edges })
}

function DepGraphStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 960, height: 520 })
  const NODES = 420

  const data = useMemo(() => buildPackageDag(NODES), [])
  const backEdges = useMemo(
    () => [...data.backEdgeMask].reduce((a, b) => a + b, 0),
    [data],
  )

  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

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

  const hoverLabel =
    hovered != null ? data.labels[hovered] : null
  const selectLabel =
    selected != null ? data.labels[selected] : null

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>
          GPUDepGraph — {fmtInt(NODES)} packages, {fmtInt(data.edgeCount)} edges,{' '}
          {fmtInt(backEdges)} back-edges
        </span>
        <span {...stylex.props(s.readoutValue)}>
          {selectLabel ? (
            `selected ${selectLabel}`
          ) : hoverLabel ? (
            hoverLabel
          ) : (
            <span {...stylex.props(s.dim)}>hover a node</span>
          )}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUDepGraph
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredNode={hovered}
            selectedNode={selected}
            onHoverNode={setHovered}
            onSelectNode={setSelected}
            aria-label="Package dependency graph"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">zoom</Hint>
        <Hint keys="drag">pan</Hint>
        <Hint keys="click">select a package</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        Sugiyama layout runs once at ingest: SCCs break cycles, ranks assign layers, barycenter
        order reduces crossings, orthogonal polylines become LineLayer segments. The GPU only draws
        — pan and zoom are viewport uniforms.
      </p>
    </div>
  )
}

const PROVIDER_OPTIONS = { profiling: true }

export function DepGraphDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <DepGraphStage />
    </GPUProvider>
  )
}
