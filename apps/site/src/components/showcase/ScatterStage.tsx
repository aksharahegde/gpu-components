'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ViewportState } from '@gpu-components/core'
import { GPUScatter, ingestColumns } from '../../../../../registry/scatter'
import { mulberry32 } from '../demos/chrome'
import { Stage } from './Stage'

export default function ScatterStage() {
  const data = useMemo(() => {
    const rnd = mulberry32(0x5ca7)
    const n = 100_000
    const x = new Float32Array(n)
    const y = new Float32Array(n)
    const category = new Uint8Array(n)
    const clusters = [
      { cx: 0.28, cy: 0.68, spread: 0.1, category: 0 },
      { cx: 0.6, cy: 0.36, spread: 0.13, category: 1 },
      { cx: 0.8, cy: 0.74, spread: 0.07, category: 2 },
    ]
    for (let i = 0; i < n; i++) {
      const c = clusters[i % clusters.length]!
      const u = Math.max(rnd(), 1e-9)
      const v = rnd()
      const r = Math.sqrt(-2 * Math.log(u)) * c.spread
      x[i] = c.cx + r * Math.cos(2 * Math.PI * v)
      y[i] = c.cy + r * Math.sin(2 * Math.PI * v)
      category[i] = c.category
    }
    return ingestColumns(x, y, category, ['baseline', 'canary', 'control'])
  }, [])

  return <Stage>{(box) => <ScatterInner data={data} box={box} />}</Stage>
}

function ScatterInner({
  data,
  box,
}: {
  data: ReturnType<typeof ingestColumns>
  box: { width: number; height: number }
}) {
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

  return <GPUScatter data={data} viewport={viewport} onViewportChange={setViewport} />
}
