'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ViewportState } from '@gpuc/core'
import { GPUHeatmap, ingestMatrix } from '../../../../../registry/heatmap'
import { Stage } from './Stage'

const HEAT_ROWS = 120
const HEAT_COLS = 200

export default function HeatmapStage() {
  const data = useMemo(() => {
    const values = new Float32Array(HEAT_ROWS * HEAT_COLS)
    for (let r = 0; r < HEAT_ROWS; r++) {
      for (let c = 0; c < HEAT_COLS; c++) {
        const gradient = (c / HEAT_COLS) * 0.4
        const d1 = Math.hypot(r / HEAT_ROWS - 0.3, c / HEAT_COLS - 0.25)
        const d2 = Math.hypot(r / HEAT_ROWS - 0.7, c / HEAT_COLS - 0.7)
        values[r * HEAT_COLS + c] =
          gradient + Math.exp(-d1 * d1 * 40) + 0.7 * Math.exp(-d2 * d2 * 25)
      }
    }
    return ingestMatrix(values, HEAT_ROWS, HEAT_COLS)
  }, [])

  return <Stage>{(box) => <HeatmapInner data={data} box={box} />}</Stage>
}

function HeatmapInner({
  data,
  box,
}: {
  data: ReturnType<typeof ingestMatrix>
  box: { width: number; height: number }
}) {
  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0,
    timeEnd: HEAT_COLS,
    trackCount: HEAT_ROWS,
    rowStart: 0,
    rowEnd: HEAT_ROWS,
    width: box.width,
    height: box.height,
  }))
  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  return <GPUHeatmap data={data} viewport={viewport} onViewportChange={setViewport} />
}
