'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpuc/react'
import type { ViewportState } from '@gpuc/core'
import { GPUScatter, ingestColumns } from '../../../../../registry/scatter'
import { fmtInt, Hint, mulberry32, PROVIDER_OPTIONS, s, useMeasuredStage } from './chrome'

const CLUSTERS = [
  { cx: 0.25, cy: 0.7, spread: 0.09, category: 0 },
  { cx: 0.62, cy: 0.35, spread: 0.13, category: 1 },
  { cx: 0.8, cy: 0.75, spread: 0.06, category: 2 },
]

function ScatterStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 400 })
  const POINTS = 250_000
  const data = useMemo(() => {
    const rnd = mulberry32(0x5ca7)
    const x = new Float32Array(POINTS)
    const y = new Float32Array(POINTS)
    const category = new Uint8Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      const cluster = CLUSTERS[i % CLUSTERS.length]!
      // Box-Muller, so the clusters look like real measurements rather than uniform blobs.
      const u = Math.max(rnd(), 1e-9)
      const v = rnd()
      const r = Math.sqrt(-2 * Math.log(u)) * cluster.spread
      x[i] = cluster.cx + r * Math.cos(2 * Math.PI * v)
      y[i] = cluster.cy + r * Math.sin(2 * Math.PI * v)
      category[i] = cluster.category
    }
    return ingestColumns(x, y, category, ['baseline', 'canary', 'control'])
  }, [])

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

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>GPUScatter — 250,000 points, one draw call</span>
        <span {...stylex.props(s.readoutValue)}>
          {selected != null ? `${fmtInt(selected)} selected` : hovered != null ? `point ${fmtInt(hovered)}` : <span {...stylex.props(s.dim)}>hover or drag to brush</span>}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUScatter
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredIndex={hovered}
            onHover={setHovered}
            onBrushSelection={(ids) => setSelected(ids.length)}
            pointSizePx={3}
            aria-label="Latency scatter"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">zoom both axes at the cursor</Hint>
        <Hint keys="drag">brush-select</Hint>
        <Hint keys="hover">inspect a point</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        The purest form of the argument on this page: 250,000 points, one instanced draw call, and
        the CPU touches none of them after upload. Zooming is a 64-byte uniform write. Hover is an
        exact same-frame lookup through a uniform grid built once. Dense scatter plots usually give
        up on same-frame hit-testing and fall back to GPU picking, which costs a frame of latency. A
        uniform grid built once at ingest makes that unnecessary here.
      </p>
    </div>
  )
}


export function ScatterDemo() {
  return (
    // Each page owns one provider, so one device serves that page's component.
    <GPUProvider options={PROVIDER_OPTIONS}>
      <ScatterStage />
    </GPUProvider>
  )
}
