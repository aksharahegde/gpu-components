'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUHistogram, ingestValues } from '../../../../../registry/histogram'
import { Hint, fmtInt, mulberry32, s, useMeasuredStage } from './chrome'

function HistogramStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 360 })
  const POINTS = 250_000

  const data = useMemo(() => {
    const rnd = mulberry32(0x4157)
    const values = new Float32Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      // Mixture of two Gaussians (Box–Muller) so adaptive bins have structure to show.
      const cluster = i % 5 === 0 ? { mu: 2.2, sigma: 0.35 } : { mu: -0.4, sigma: 0.9 }
      const u = Math.max(rnd(), 1e-9)
      const v = rnd()
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      values[i] = cluster.mu + cluster.sigma * z
    }
    return ingestValues(values)
  }, [])

  const [hovered, setHovered] = useState<number | null>(null)

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: data.domain.min,
    timeEnd: data.domain.max,
    trackCount: 1,
    rowStart: 0,
    rowEnd: 1,
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
        <span {...stylex.props(s.panelTitle)}>
          GPUHistogram — {fmtInt(POINTS)} values, {data.binCount} {data.method} bins
        </span>
        <span {...stylex.props(s.readoutValue)}>
          {hovered != null ? `bin ${fmtInt(hovered)}` : <span {...stylex.props(s.dim)}>hover a bin</span>}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUHistogram
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredBin={hovered}
            onHoverBin={setHovered}
            aria-label="Value histogram"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">zoom the value axis</Hint>
        <Hint keys="drag">pan</Hint>
        <Hint keys="hover">inspect a bin</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        Bin edges come from Freedman–Diaconis at ingest (Sturges if the IQR collapses). A compute
        pass atomically fills those buckets; bars are one instanced draw. Pan and zoom never touch
        the value buffer.
      </p>
    </div>
  )
}

const PROVIDER_OPTIONS = { profiling: true }

export function HistogramDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <HistogramStage />
    </GPUProvider>
  )
}
