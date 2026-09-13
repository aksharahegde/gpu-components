'use client'

import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpuc/react'
import type { ViewportState } from '@gpuc/core'
import {
  GPUAnnotationCanvas,
  createAnnotationId,
  ingestField,
  type Annotation,
  type FieldData,
  type ToolName,
} from '../../../../../registry/annotationcanvas'
import { Btn, Dim, Field, Hint, Panel, PROVIDER_OPTIONS, Readout, s, Segmented, useMeasuredStage } from './chrome'

/** 512, not the spec's upper bound of 1024 — plenty of pixels for a colormap demo, and it keeps
 * the ingest + first paint snappy on the page load path. */
const FIELD_SIZE = 512

const TOOLS: readonly ToolName[] = ['pan', 'select', 'rect', 'ellipse', 'point', 'ruler', 'polygon', 'freehand']

/** Three Gaussian peaks over a faint gradient — a stand-in for a scientific/medical scalar field,
 * with enough shape variety that the window slider has something to reveal. */
function buildField(size: number): FieldData {
  const values = new Float32Array(size * size)
  const peaks = [
    { cx: 0.3, cy: 0.32, sigma: 0.09, amp: 1 },
    { cx: 0.7, cy: 0.62, sigma: 0.12, amp: 0.8 },
    { cx: 0.55, cy: 0.22, sigma: 0.06, amp: 0.55 },
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size
      const ny = y / size
      let v = 0.05 * (nx + ny)
      for (const p of peaks) {
        const d2 = (nx - p.cx) ** 2 + (ny - p.cy) ** 2
        v += p.amp * Math.exp(-d2 / (2 * p.sigma * p.sigma))
      }
      values[y * size + x] = v
    }
  }
  return ingestField({ width: size, height: size, values })
}

function seedAnnotations(size: number): Annotation[] {
  return [
    {
      id: createAnnotationId(),
      kind: 'rect',
      x: size * 0.24,
      y: size * 0.22,
      w: size * 0.14,
      h: size * 0.14,
      label: 'peak A',
    },
    {
      id: createAnnotationId(),
      kind: 'ellipse',
      x: size * 0.6,
      y: size * 0.52,
      w: size * 0.24,
      h: size * 0.2,
      label: 'peak B',
    },
    { id: createAnnotationId(), kind: 'ruler', x0: size * 0.08, y0: size * 0.9, x1: size * 0.4, y1: size * 0.9 },
  ]
}

function AnnotationCanvasStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 440 })

  const field = useMemo(() => buildField(FIELD_SIZE), [])
  const [annotations, setAnnotations] = useState<Annotation[]>(() => seedAnnotations(FIELD_SIZE))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<ToolName>('pan')
  const [windowState, setWindowState] = useState(field.window)

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0,
    timeEnd: field.width,
    trackCount: field.height,
    rowStart: 0,
    rowEnd: field.height,
    yContinuous: true,
    width: box.width,
    height: box.height,
  }))

  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  const onCreate = useCallback((annotation: Annotation) => {
    setAnnotations((prev) => [...prev, annotation])
    setSelectedId(annotation.id)
  }, [])

  const onChange = useCallback((annotation: Annotation) => {
    setAnnotations((prev) => prev.map((a) => (a.id === annotation.id ? annotation : a)))
  }, [])

  const onDelete = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
    setSelectedId(null)
  }, [])

  const resetShapes = useCallback(() => {
    setAnnotations(seedAnnotations(FIELD_SIZE))
    setSelectedId(null)
  }, [])

  const windowStep = (field.window.max - field.window.min) / 200

  const selected = annotations.find((a) => a.id === selectedId) ?? null

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.controls)}>
        <Field label="Tool">
          <Segmented options={TOOLS} value={tool} onChange={setTool} />
        </Field>
        <Field label="Window min">
          <input
            type="range"
            min={field.window.min}
            max={field.window.max}
            step={windowStep}
            value={windowState.min}
            onChange={(e) => setWindowState((w) => ({ ...w, min: Number(e.target.value) }))}
          />
        </Field>
        <Field label="Window max">
          <input
            type="range"
            min={field.window.min}
            max={field.window.max}
            step={windowStep}
            value={windowState.max}
            onChange={(e) => setWindowState((w) => ({ ...w, max: Number(e.target.value) }))}
          />
        </Field>
        <Btn onClick={resetShapes}>Reset shapes</Btn>
      </div>

      <p {...stylex.props(s.blurb)}>
        A synthetic Float32 field — three Gaussian peaks over a gradient — with a host-owned
        annotation overlay. Every draw tool below only emits an event; this page's state decides
        whether to keep the result.
      </p>

      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'pending' && <div {...stylex.props(s.overlayMsg)}>Requesting a GPU device…</div>}
        {status === 'unsupported' && (
          <div {...stylex.props(s.overlayMsg)}>
            <strong {...stylex.props(s.strong)}>WebGPU is unavailable in this browser.</strong>
          </div>
        )}
        {status === 'ready' && box.width > 1 && (
          <GPUAnnotationCanvas
            field={field}
            annotations={annotations}
            tool={tool}
            viewport={viewport}
            onViewportChange={setViewport}
            window={windowState}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreate={onCreate}
            onChange={onChange}
            onDelete={onDelete}
            aria-label="Example annotation canvas"
          />
        )}
      </div>

      <div {...stylex.props(s.hints)}>
        <Hint keys="drag">pan, or draw with the active tool</Hint>
        <Hint keys="ctrl + wheel">zoom at the cursor</Hint>
        <Hint keys="dblclick / Enter">close a polygon</Hint>
        <Hint keys="Esc">cancel the in-progress draft</Hint>
        <Hint keys="Delete">remove the selection</Hint>
      </div>

      <div {...stylex.props(s.panels)}>
        <Panel title="Annotations">
          <Readout label="Count">{annotations.length}</Readout>
          <Readout label="Selected">{selected ? selected.kind : <Dim>none</Dim>}</Readout>
        </Panel>
        <Panel title="Window">
          <Readout label="Min">{windowState.min.toFixed(3)}</Readout>
          <Readout label="Max">{windowState.max.toFixed(3)}</Readout>
        </Panel>
      </div>

      <p {...stylex.props(s.footnote)}>
        Interaction is hybrid: <code>annotations</code> is a host-owned prop,
        and <code>GPUAnnotationCanvas</code> never mutates it directly — it emits{' '}
        <code>onCreate</code>/<code>onChange</code>/<code>onDelete</code> for this page to apply.
      </p>
    </div>
  )
}

export function AnnotationCanvasDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <AnnotationCanvasStage />
    </GPUProvider>
  )
}
