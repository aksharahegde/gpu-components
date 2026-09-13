'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ViewportState } from '@gpu-components/core'
import { GPUDataGrid, ingestRows, type GridColumn } from '../../../../../registry/grid'
import { mulberry32 } from '../demos/chrome'
import { Stage } from './Stage'

const GRID_COLUMNS: GridColumn[] = [
  { key: 'service', label: 'Service', width: 130 },
  { key: 'p95', label: 'p95 (ms)', width: 96, numeric: true, align: 'right' },
  { key: 'rps', label: 'Req/s', width: 96, numeric: true, align: 'right' },
  { key: 'errors', label: 'Errors', width: 84, numeric: true, align: 'right' },
]
const GRID_SERVICES = ['checkout', 'catalog', 'identity', 'billing', 'search', 'inventory']
const GRID_ROWS = 5_000
const GRID_VISIBLE = 8

export default function GridStage() {
  const data = useMemo(() => {
    const rnd = mulberry32(0x91d)
    return ingestRows(
      Array.from({ length: GRID_ROWS }, (_, i) => ({
        service: GRID_SERVICES[i % GRID_SERVICES.length],
        p95: Math.round(rnd() * rnd() * 800 * 10) / 10,
        rps: Math.round(rnd() * 4000),
        errors: Math.round(rnd() * rnd() * 120),
      })),
      GRID_COLUMNS,
    )
  }, [])

  return <Stage>{(box) => <GridInner data={data} box={box} />}</Stage>
}

function GridInner({
  data,
  box,
}: {
  data: ReturnType<typeof ingestRows>
  box: { width: number; height: number }
}) {
  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0,
    timeEnd: 1,
    trackCount: GRID_ROWS,
    rowStart: 0,
    rowEnd: GRID_VISIBLE,
    width: box.width,
    height: box.height,
  }))
  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  return <GPUDataGrid data={data} viewport={viewport} onViewportChange={setViewport} />
}
