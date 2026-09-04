'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUSpreadsheet } from '../../../../../registry/spreadsheet'
import { Hint, s, useMeasuredStage } from './chrome'

const ROWS = 60

/** A small budget worksheet with real formulas — `B12` sums a column, `D2:D11` divides two other
 * columns, and `E2` deliberately references itself so the demo shows the `#CIRCULAR!` path live. */
const INITIAL_CELLS: Record<string, string> = {
  A1: 'Category',
  B1: 'Budget',
  C1: 'Spent',
  D1: 'Remaining',
  A2: 'Infra',
  B2: '12000',
  C2: '9400',
  D2: '=B2-C2',
  A3: 'Tooling',
  B3: '3200',
  C3: '2100',
  D3: '=B3-C3',
  A4: 'Hosting',
  B4: '5400',
  C4: '5600',
  D4: '=B4-C4',
  A5: 'Design',
  B5: '1800',
  C5: '900',
  D5: '=B5-C5',
  A11: 'Total',
  B11: '=SUM(B2:B5)',
  C11: '=SUM(C2:C5)',
  D11: '=SUM(D2:D5)',
  F2: 'Over budget?',
  G2: '=IF(D2<0,"yes","no")',
  G3: '=IF(D3<0,"yes","no")',
  G4: '=IF(D4<0,"yes","no")',
  G5: '=IF(D5<0,"yes","no")',
}

function SpreadsheetStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 380 })

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
        <span {...stylex.props(s.panelTitle)}>GPUSpreadsheet — editable, formula-driven</span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUSpreadsheet
            rowCount={ROWS}
            initialCells={INITIAL_CELLS}
            viewport={viewport}
            onViewportChange={setViewport}
            aria-label="Budget worksheet"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="double-click / Enter">edit a cell</Hint>
        <Hint keys="arrows">move</Hint>
        <Hint keys="shift + arrows">extend selection</Hint>
        <Hint keys="⌘/Ctrl + C / V">copy, paste</Hint>
        <Hint keys="wheel">scroll rows</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        Formulas are CPU-only — a dependency graph and topological recalculation, never the GPU
        (PLAN.md §5.2 bans exactly the string handling and branchy small-N work a formula engine
        is). The GPU draws cell chrome, the selection rectangle, and a brief flash on cells the
        engine just recalculated; text is the same measured Canvas2D layer{' '}
        <code>GPUDataGrid</code> uses. Try typing <code>=D2+1</code> into <code>D3</code> then{' '}
        <code>=D3+1</code> into <code>D2</code> — the engine catches the cycle instead of hanging.
      </p>
    </div>
  )
}

const PROVIDER_OPTIONS = { profiling: true }

export function SpreadsheetDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <SpreadsheetStage />
    </GPUProvider>
  )
}
