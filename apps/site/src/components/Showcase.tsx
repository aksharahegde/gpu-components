'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUTimeline, ingestSpans, type RawSpan } from '../../../../registry/timeline'
import { GPUScatter, ingestColumns } from '../../../../registry/scatter'
import { GPUHeatmap, ingestMatrix } from '../../../../registry/heatmap'
import { GPUDataGrid, ingestRows, type GridColumn } from '../../../../registry/grid'
import { PROVIDER_OPTIONS, mulberry32, useMeasuredStage } from './demos/chrome'
import { color, font, radius, shadow } from '../tokens.stylex'

/**
 * Four components, one `<GPUProvider>` — the landing page's central claim, rendered rather than
 * asserted.
 *
 * Two things make this different from a playground page. First, every demo under `demos/` wraps
 * its *own* provider, because one page there shows one component; mounting four of those here
 * would create four devices and demonstrate the opposite of the point. These stages are therefore
 * written against the registry components directly and share the single provider below.
 *
 * Second, the caption is derived, not written, so the figure on screen cannot drift from the truth
 * the way a hard-coded "four components, one device" would. That mattered immediately: the first
 * version read `profiler.lastFrame.componentCount` and rendered "1 component", because that field
 * counts components the scheduler *redrew* on the last tick, not components mounted — settled
 * components are skipped, which is the whole point of the dirty flag. The caption now reports both
 * numbers and says which is which.
 */
export function Showcase() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <ShowcaseBody />
    </GPUProvider>
  )
}

function ShowcaseBody() {
  const { status } = useGpu()
  const { ref, visible } = useLazyMount()

  return (
    <div ref={ref} {...stylex.props(s.root)}>
      <div {...stylex.props(s.grid)}>
        <Panel title="GPUTimeline" note="50,000 spans">
          {visible && <TimelineStage />}
        </Panel>
        <Panel title="GPUScatter" note="100,000 points, one draw call">
          {visible && <ScatterStage />}
        </Panel>
        <Panel title="GPUHeatmap" note="120 × 200, GPU colormap">
          {visible && <HeatmapStage />}
        </Panel>
        <Panel title="GPUDataGrid" note="5,000 rows, per-cell shading">
          {visible && <GridStage />}
        </Panel>
      </div>
      <Caption status={status} started={visible} />
    </div>
  )
}

/**
 * Defers mounting until the section is near the viewport. Four GPU components above the fold would
 * be paid for by every visitor on arrival, including the ones who never scroll this far.
 *
 * `rootMargin` starts the work a screen early so the panels are usually settled by the time they
 * are actually looked at, and the observer disconnects after the first hit — this is a one-way
 * latch, not a visibility toggle. Unmounting a settled GPU component to save nothing would only
 * make scrolling back up expensive.
 */
function useLazyMount() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return { ref, visible }
}

/** Polls the runtime. There is no push subscription for either of these. */
function Caption({ status, started }: { status: string; started: boolean }) {
  const { runtime } = useGpu()
  const [stats, setStats] = useState<{ mounted: number; redrawn: number } | null>(null)

  useEffect(() => {
    if (!runtime || !started) return
    const id = setInterval(() => {
      setStats({
        mounted: runtime.mountedCount,
        redrawn: runtime.profiler.lastFrame?.componentCount ?? 0,
      })
    }, 500)
    return () => clearInterval(id)
  }, [runtime, started])

  if (status === 'unsupported') {
    return (
      <p {...stylex.props(s.caption)}>
        This browser has no WebGPU, so the panels above are empty — which is the honest outcome, not
        a broken page. Every component documents its fallback.
      </p>
    )
  }

  return (
    <p {...stylex.props(s.caption)}>
      {stats == null || stats.mounted === 0 ? (
        <>Starting the runtime…</>
      ) : (
        <>
          <strong {...stylex.props(s.captionStrong)}>
            {stats.mounted} component{stats.mounted === 1 ? '' : 's'}, one GPUDevice, one submit per
            frame.
          </strong>{' '}
          The scheduler redrew {stats.redrawn} of them on its last tick — a component that has not
          changed is skipped entirely. Both numbers are read from the live runtime, not written into
          this sentence.
        </>
      )}
    </p>
  )
}

function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <figure {...stylex.props(s.panel)}>
      <figcaption {...stylex.props(s.panelHead)}>
        <span {...stylex.props(s.panelTitle)}>{title}</span>
        <span {...stylex.props(s.panelNote)}>{note}</span>
      </figcaption>
      <div {...stylex.props(s.panelStage)}>{children}</div>
    </figure>
  )
}

/**
 * Shared shell for the four stages: measures its box and renders nothing until the runtime is up
 * and the element has a real width, which every registry component requires (they size from
 * `viewport.width/height` rather than observing their own canvas — PLAN.md §11.1).
 */
function Stage({
  children,
}: {
  children: (box: { width: number; height: number }) => ReactNode
}) {
  const { status } = useGpu()
  const { ref, box } = useMeasuredStage({ width: 520, height: 200 })
  return (
    <div ref={ref} {...stylex.props(s.stageBox)}>
      {status === 'ready' && box.width > 1 && children(box)}
    </div>
  )
}

const SPAN_NAMES = ['fetchUser', 'db.query', 'render', 'auth.verify', 'cache.get', 'net.write']
const DOMAIN_MS = 60_000

function TimelineStage() {
  const spans = useMemo(() => {
    const rnd = mulberry32(0x5eed)
    const raw: RawSpan[] = new Array(50_000)
    for (let i = 0; i < raw.length; i++) {
      const burst = Math.floor(rnd() * 240)
      raw[i] = {
        start: (burst / 240) * DOMAIN_MS + rnd() * (DOMAIN_MS / 240) * 0.6,
        duration: rnd() * rnd() * 40 + 0.05,
        track: Math.floor(rnd() * 8),
        label: SPAN_NAMES[i % SPAN_NAMES.length]!,
      }
    }
    return ingestSpans(raw)
  }, [])

  return (
    <Stage>
      {(box) => <TimelineInner spans={spans} box={box} />}
    </Stage>
  )
}

function TimelineInner({
  spans,
  box,
}: {
  spans: ReturnType<typeof ingestSpans>
  box: { width: number; height: number }
}) {
  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0,
    timeEnd: DOMAIN_MS,
    trackCount: 8,
    rowStart: 0,
    rowEnd: 8,
    width: box.width,
    height: box.height,
  }))
  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  return <GPUTimeline spans={spans} viewport={viewport} onViewportChange={setViewport} />
}

function ScatterStage() {
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

const HEAT_ROWS = 120
const HEAT_COLS = 200

function HeatmapStage() {
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

const GRID_COLUMNS: GridColumn[] = [
  { key: 'service', label: 'Service', width: 130 },
  { key: 'p95', label: 'p95 (ms)', width: 96, numeric: true, align: 'right' },
  { key: 'rps', label: 'Req/s', width: 96, numeric: true, align: 'right' },
  { key: 'errors', label: 'Errors', width: 84, numeric: true, align: 'right' },
]
const GRID_SERVICES = ['checkout', 'catalog', 'identity', 'billing', 'search', 'inventory']
const GRID_ROWS = 5_000
const GRID_VISIBLE = 8

function GridStage() {
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

const PANELS = '@media (max-width: 860px)'

const s = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: 16 },
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, minmax(0, 1fr))', [PANELS]: 'minmax(0, 1fr)' },
    gap: 16,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    margin: 0,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    boxShadow: shadow.sm,
    overflow: 'hidden',
  },
  panelHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingBlock: 10,
    paddingInline: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  panelTitle: { fontFamily: font.mono, fontSize: 13, fontWeight: 600, color: color.text },
  panelNote: { fontFamily: font.mono, fontSize: 11.5, color: color.textFaint },
  panelStage: { position: 'relative', height: 208, backgroundColor: color.bgRaised },
  stageBox: { position: 'absolute', inset: 0 },
  caption: { fontSize: 14, lineHeight: 1.6, color: color.textDim, margin: 0 },
  captionStrong: { color: color.text, fontWeight: 600 },
})
