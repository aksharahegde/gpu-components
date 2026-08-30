'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUDataGrid, ingestRows, type GridColumn } from '../../../../../registry/grid'
import { Hint, mulberry32, s, useMeasuredStage } from './chrome'

const GRID_COLUMNS: GridColumn[] = [
  { key: 'id', label: 'ID', width: 70, numeric: true, align: 'right' },
  { key: 'service', label: 'Service', width: 150 },
  { key: 'endpoint', label: 'Endpoint', width: 230 },
  { key: 'p95', label: 'p95 (ms)', width: 100, numeric: true, align: 'right' },
  { key: 'rps', label: 'Req/s', width: 100, numeric: true, align: 'right' },
  { key: 'errors', label: 'Errors', width: 90, numeric: true, align: 'right' },
  { key: 'region', label: 'Region', width: 110 },
]

const SERVICES = ['checkout', 'catalog', 'identity', 'billing', 'search', 'inventory']
const REGIONS = ['us-east-1', 'eu-west-2', 'ap-south-1']
const ENDPOINTS = ['/v1/orders', '/v1/items/:id', '/v1/session', '/v1/invoice', '/v1/query', '/health']

function GridStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 380 })
  const ROWS = 5_000
  const data = useMemo(() => {
    const rnd = mulberry32(0x91d)
    return ingestRows(
      Array.from({ length: ROWS }, (_, i) => ({
        id: i,
        service: SERVICES[i % SERVICES.length],
        endpoint: ENDPOINTS[(i * 7) % ENDPOINTS.length],
        p95: Math.round(rnd() * rnd() * 800 * 10) / 10,
        rps: Math.round(rnd() * 4000),
        errors: Math.round(rnd() * rnd() * 120),
        region: REGIONS[i % REGIONS.length],
      })),
      GRID_COLUMNS,
    )
  }, [])

  const [selected, setSelected] = useState<number | null>(null)


  const VISIBLE_ROWS = 16
  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0,
    timeEnd: 1,
    trackCount: ROWS,
    rowStart: 0,
    rowEnd: VISIBLE_ROWS,
    width: box.width,
    height: box.height,
  }))

  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>GPUDataGrid — the flagship, built last on purpose</span>
        <span {...stylex.props(s.readoutValue)}>
          {selected == null ? <span {...stylex.props(s.dim)}>click a row</span> : `row ${selected}`}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUDataGrid
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            selectedRow={selected}
            onSelectRow={setSelected}
            aria-label="Service latency grid"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">scroll rows</Hint>
        <Hint keys="shift + wheel">scroll columns</Hint>
        <Hint keys="click">select a row</Hint>
        <Hint keys="Tab then arrows">walk rows</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        A hybrid, and the split is measured rather than assumed. The GPU draws zebra striping and
        the per-cell conditional formatting — every numeric cell tinted by where its value sits in
        that column&apos;s full range, evaluated in the fragment shader. The text is a Canvas2D
        layer, because <code>spikes/grid-text-budget.md</code> measured 2,400 cells of it at 2.9ms
        per frame with zero dropped frames, against a glyph atlas that PLAN.md ranked as the largest
        schedule risk in the phase. The DOM draws nothing per cell: it dropped every frame past
        ~1,200 nodes. Read-only in v1 — editing, copy/paste and column resize are the grid semantics
        §8.1 warns will consume a schedule.
      </p>
    </div>
  )
}


/** Stable identity: a fresh object each render trips GPUProvider's "options changed" warning. */
const PROVIDER_OPTIONS = { profiling: true }

export function GridDemo() {
  return (
    // Each page owns one provider, so one device serves that page's component.
    <GPUProvider options={PROVIDER_OPTIONS}>
      <GridStage />
    </GPUProvider>
  )
}
