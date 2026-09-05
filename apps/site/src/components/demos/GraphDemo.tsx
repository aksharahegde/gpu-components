'use client'

import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GPUProvider, GpuInspector, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUGraph, generateClusteredGraph } from '../../../../../registry/graph'
import { Btn, Dim, Field, Hint, Panel, Readout, Segmented, fmtInt, s, useMeasuredStage } from './chrome'

const CLUSTER_COUNTS = [2, 3, 5] as const
const NODES_PER_CLUSTER = [10, 25, 60] as const

function GraphStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 440 })

  const [clusters, setClusters] = useState<number>(3)
  const [perCluster, setPerCluster] = useState<number>(25)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState({ iterations: 0, settled: false })
  const [runId, setRunId] = useState(0)

  const { graph, droppedEdges } = useMemo(
    // runId is part of the key so "restart" produces a genuinely new dataset object, which is what
    // the component watches to reset its simulation.
    () => generateClusteredGraph(perCluster, clusters, 0x5eed + runId),
    [perCluster, clusters, runId],
  )

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: -1.4,
    timeEnd: 1.4,
    trackCount: 1,
    rowStart: -1.4,
    rowEnd: 1.4,
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
        <Field label="Clusters">
          <Segmented options={CLUSTER_COUNTS} value={clusters} onChange={setClusters} />
        </Field>
        <Field label="Nodes each">
          <Segmented options={NODES_PER_CLUSTER} value={perCluster} onChange={setPerCluster} />
        </Field>
        <Btn onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</Btn>
        <Btn onClick={() => setRunId((n) => n + 1)}>Restart layout</Btn>
      </div>

      <p {...stylex.props(s.blurb)}>
        Densely-linked groups with a few bridges between them. The layout starts on a seeded ring and
        pulls itself apart.
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
          <GPUGraph
            data={graph}
            viewport={viewport}
            onViewportChange={setViewport}
            paused={paused}
            onIterate={onIterate}
            nodeSizePx={9}
            aria-label="Clustered graph"
          />
        )}
      </div>

      <div {...stylex.props(s.hints)}>
        <Hint keys="drag">pan</Hint>
        <Hint keys="wheel">zoom both axes</Hint>
      </div>

      <div {...stylex.props(s.panels)}>
        <Panel title="Simulation">
          <Readout label="Nodes">{fmtInt(graph.nodeCount)}</Readout>
          <Readout label="Edges">{fmtInt(graph.edgeCount)}</Readout>
          <Readout label="Iterations">{fmtInt(progress.iterations)}</Readout>
          <Readout label="State">
            {paused ? 'paused' : progress.settled ? 'settled' : 'settling…'}
          </Readout>
          {droppedEdges > 0 && <Readout label="Dropped edges">{fmtInt(droppedEdges)}</Readout>}
          <p {...stylex.props(s.note)}>
            The only component here that animates: it keeps asking the scheduler for frames until the
            layout converges, then stops on its own.
          </p>
        </Panel>

        <Panel title="Interaction">
          <Readout label="Hover">
            <Dim>not supported</Dim>
          </Readout>
          <p {...stylex.props(s.note)}>
            Deliberately, and it is the interesting part. Every other component hit-tests on the CPU
            because its coordinates sit in a typed array. A graph&apos;s coordinates move every
            iteration and live only in GPU memory, so there is nothing on the CPU to test against.
            This is the case that genuinely needs asynchronous GPU picking: there is no cheap CPU
            index for node positions that change every frame.
          </p>
        </Panel>

        <Panel title="Inspector">
          <div {...stylex.props(s.inspector)}>
            <GpuInspector />
          </div>
        </Panel>
      </div>

      <p {...stylex.props(s.footnote)}>
        Repulsion is an exact O(n²) loop, which is the right choice up to roughly 5,000 nodes and the
        wrong one above it — the component says so through the inspector&apos;s warnings pane rather
        than quietly bogging down. Positions ping-pong between two storage buffers, so a frame reads
        what the previous one wrote and nothing is allocated inside the loop.
      </p>
    </div>
  )
}

/** Stable identity: a fresh object each render trips GPUProvider's "options changed" warning. */
const PROVIDER_OPTIONS = { profiling: true }

export function GraphDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <GraphStage />
    </GPUProvider>
  )
}
