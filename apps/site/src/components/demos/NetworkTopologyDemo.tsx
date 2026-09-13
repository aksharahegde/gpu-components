'use client'

import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GPUProvider, GpuInspector, useGpu } from '@gpuc/react'
import type { ViewportState } from '@gpuc/core'
import { GPUNetworkTopology, generateMesh } from '../../../../../registry/networktopology'
import { color } from '../../tokens.stylex'
import { Btn, Dim, Field, fmtInt, Hint, Panel, PROVIDER_OPTIONS, Readout, s, Segmented, useMeasuredStage } from './chrome'

const MODES = ['schematic', 'stress'] as const

function TopologyStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 440 })

  const [mode, setMode] = useState<(typeof MODES)[number]>('schematic')
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState({ iterations: 0, settled: false })

  const data = useMemo(() => generateMesh({ mode, seed: 0x7e55 }), [mode])

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: -4,
    timeEnd: 4,
    trackCount: 1,
    rowStart: -4,
    rowEnd: 4,
    yContinuous: true,
    width: box.width,
    height: box.height,
  }))

  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  const onIterate = useCallback((iterations: number, settled: boolean) => {
    setProgress({ iterations, settled })
  }, [])

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.controls)}>
        <Field label="Mode">
          <Segmented options={MODES} value={mode} onChange={setMode} />
        </Field>
        <Btn onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</Btn>
      </div>

      <p {...stylex.props(s.blurb)}>
        A region/AZ/service/pod schematic in <Dim>schematic</Dim> mode, a flat 4,000-host mesh in{' '}
        <Dim>stress</Dim> mode. Both start on a seeded ring and settle under the same force layout
        <code> GPUGraph</code> uses.
      </p>

      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'pending' && <div {...stylex.props(s.overlayMsg)}>Requesting a GPU device…</div>}
        {status === 'unsupported' && (
          <div {...stylex.props(s.overlayMsg)}>
            <strong {...stylex.props(s.strong)}>WebGPU is unavailable in this browser.</strong>
            <br />
            This component has no Canvas2D fallback: its node positions are produced and consumed
            entirely on the GPU.
          </div>
        )}
        {status === 'ready' && box.width > 1 && (
          <GPUNetworkTopology
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            paused={paused}
            onIterate={onIterate}
            nodeSizePx={7}
            aria-label="Network topology"
          />
        )}
      </div>

      <div {...stylex.props(s.hints)}>
        <Hint keys="drag">pan</Hint>
        <Hint keys="wheel">zoom both axes</Hint>
      </div>

      <div {...stylex.props(s.panels)}>
        <Panel title="Simulation">
          <Readout label="Nodes">{fmtInt(data.nodeCount)}</Readout>
          <Readout label="Edges">{fmtInt(data.edgeCount)}</Readout>
          <Readout label="Iterations">{fmtInt(progress.iterations)}</Readout>
          <Readout label="State">
            {paused ? 'paused' : progress.settled ? 'settled' : 'settling…'}
          </Readout>
        </Panel>

        <Panel title="Legend">
          <div {...stylex.props(t.row)}>
            <span {...stylex.props(t.dot, t.up)} />
            <span>up</span>
          </div>
          <div {...stylex.props(t.row)}>
            <span {...stylex.props(t.dot, t.degraded)} />
            <span>degraded</span>
          </div>
          <div {...stylex.props(t.row)}>
            <span {...stylex.props(t.dot, t.down)} />
            <span>down</span>
          </div>
          <p {...stylex.props(s.note)}>
            Hot links — high health, high traffic — pulse along their length; the pulse is a
            separate clock from the layout, so it keeps moving after the graph settles.
          </p>
        </Panel>

        <Panel title="Interaction">
          <Readout label="Hover">
            <Dim>not supported</Dim>
          </Readout>
          <p {...stylex.props(s.note)}>
            Same reason as <code>GPUGraph</code>: positions move every layout iteration and live only
            in GPU memory, so there is nothing on the CPU to hit-test against.
          </p>
        </Panel>

        <Panel title="Inspector">
          <div {...stylex.props(s.inspector)}>
            <GpuInspector />
          </div>
        </Panel>
      </div>

      <p {...stylex.props(s.footnote)}>
        The force layout is GPU-resident — same ping-pong buffer approach as <code>GPUGraph</code>.
        The layout animation can still stutter in some browsers — a bug we are tracking, and the
        reason this component is demo-only for now.
      </p>
    </div>
  )
}

const t = stylex.create({
  row: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: color.textDim },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  up: { backgroundColor: color.mint },
  degraded: { backgroundColor: color.amber },
  down: { backgroundColor: color.rose },
})

export function NetworkTopologyDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <TopologyStage />
    </GPUProvider>
  )
}
