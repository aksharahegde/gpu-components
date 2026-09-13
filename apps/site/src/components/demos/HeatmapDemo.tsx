'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpuc/react'
import type { ViewportState } from '@gpuc/core'
import { GPUHeatmap, ingestMatrix, type HeatmapData } from '../../../../../registry/heatmap'
import { Hint, PROVIDER_OPTIONS, s, useMeasuredStage } from './chrome'

function buildMatrix(rows: number, cols: number): HeatmapData {
  const values = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gradient = (c / cols) * 0.4
      const d1 = Math.hypot(r / rows - 0.3, c / cols - 0.25)
      const d2 = Math.hypot(r / rows - 0.7, c / cols - 0.7)
      values[r * cols + c] = gradient + Math.exp(-d1 * d1 * 40) + 0.7 * Math.exp(-d2 * d2 * 25)
    }
  }
  return ingestMatrix(values, rows, cols)
}

function HeatmapStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 320 })
  const ROWS = 120
  const COLS = 200
  const data = useMemo(() => buildMatrix(ROWS, COLS), [])
  const [hovered, setHovered] = useState<number | null>(null)


  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0,
    timeEnd: COLS,
    trackCount: ROWS,
    rowStart: 0,
    rowEnd: ROWS,
    width: box.width,
    height: box.height,
  }))

  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  const hoveredText =
    hovered == null
      ? null
      : `row ${Math.floor(hovered / COLS)}, col ${hovered % COLS} = ${data.values[hovered]?.toFixed(3)}`

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>GPUHeatmap — the same runtime, a second component</span>
        <span {...stylex.props(s.readoutValue)}>
          {hoveredText ?? <span {...stylex.props(s.dim)}>hover a cell</span>}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUHeatmap
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredCell={hovered}
            onHoverCell={setHovered}
            aria-label="Example heatmap"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="drag">pan both axes</Hint>
        <Hint keys="wheel">scroll rows</Hint>
        <Hint keys="ctrl + wheel">zoom at the cursor</Hint>
        <Hint keys="Tab then arrows">walk cells</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        This component was the architecture test: it was built to find out whether{' '}
        <code>@gpuc/core</code> could host a second, differently-shaped component without
        changes. It needed exactly one — a second axis on the viewport — and that one change was
        written down rather than quietly patched.
      </p>
    </div>
  )
}


export function HeatmapDemo() {
  return (
    // Each page owns one provider, so one device serves that page's component.
    <GPUProvider options={PROVIDER_OPTIONS}>
      <HeatmapStage />
    </GPUProvider>
  )
}
