'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { GPUProvider, GpuInspector, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUTimeline, ingestSpans, type RawSpan, type SpanBuffers } from '../../../../registry/timeline'
import { GPUHeatmap, ingestMatrix, type HeatmapData } from '../../../../registry/heatmap'
import { GPUDataGrid, ingestRows, type GridColumn } from '../../../../registry/grid'
import { GPUScatter, ingestColumns } from '../../../../registry/scatter'
import { color, font, radius } from '../tokens.stylex'

/**
 * PLAN.md §27's playground — the part of the project that has to be *felt* rather than read.
 *
 * Everything else about this runtime is verified by tests and benchmark tables, which prove it
 * works without ever letting anyone see it work. This page exists so the component can be grabbed:
 * pan it, zoom into a nanosecond, hover a span, drag a brush across a hundred thousand of them,
 * tab through it with the keyboard, and watch the GPU inspector report what each frame actually
 * cost while you do.
 *
 * Deliberately *not* the full §27 spec: there is no renderer toggle (DOM/Canvas2D/WebGPU on the
 * same data) yet, because the Canvas2D fallback's runtime path is unbuilt — see §22's status. The
 * head-to-head comparison lives on the home page's benchmark for now; this is the "feel the
 * component" half.
 */

const SIZES = [1_000, 10_000, 100_000, 500_000] as const
const SHAPES = ['bursty', 'shallow-wide', 'deep-nested'] as const
type Shape = (typeof SHAPES)[number]

const SHAPE_BLURB: Record<Shape, string> = {
  bursty: 'Realistic trace clustering — dense knots separated by quiet gaps.',
  'shallow-wide': 'Many tracks, little nesting. The width-bound case.',
  'deep-nested': 'Flame-graph shaped: deep call stacks, heavy overlap per track.',
}

/** Deterministic PRNG, so the dataset you are looking at is the dataset anyone else sees. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = [
  'fetchUser', 'db.query', 'render', 'serialize', 'auth.verify', 'cache.get',
  'llm.completion', 'tool.call', 'parse', 'compress', 'net.write', 'index.scan',
]

/** Total domain, in milliseconds — a 60-second trace, so zooming to a single span is a real journey. */
const DOMAIN_MS = 60_000

function buildSpans(shape: Shape, size: number, trackCount: number): RawSpan[] {
  const rnd = mulberry32(0x5eed)
  const spans: RawSpan[] = new Array(size)

  for (let i = 0; i < size; i++) {
    let start: number
    let duration: number
    let track: number

    if (shape === 'bursty') {
      // Cluster into ~240 bursts, each a short window of heavy activity.
      const burst = Math.floor(rnd() * 240)
      const burstStart = (burst / 240) * DOMAIN_MS
      start = burstStart + rnd() * (DOMAIN_MS / 240) * 0.6
      duration = rnd() * rnd() * 40 + 0.05
      track = Math.floor(rnd() * trackCount)
    } else if (shape === 'shallow-wide') {
      start = rnd() * DOMAIN_MS
      duration = rnd() * 12 + 0.05
      track = Math.floor(rnd() * trackCount)
    } else {
      // Deep-nested: each track is a stack depth, and deeper spans are shorter and later.
      track = Math.floor(rnd() ** 0.6 * trackCount)
      const depthScale = 1 / (track + 1)
      start = rnd() * DOMAIN_MS
      duration = (rnd() * 300 + 0.05) * depthScale
    }

    spans[i] = {
      start,
      duration,
      track,
      // Only wide spans will ever be labelled (the label budget is bounded by screen width), but
      // every span carries one so hover and the a11y tree always have something to say.
      label: NAMES[i % NAMES.length],
    }
  }
  return spans
}

function fmtMs(ms: number): string {
  if (Math.abs(ms) >= 1000) return `${(ms / 1000).toFixed(3)}s`
  if (Math.abs(ms) >= 1) return `${ms.toFixed(2)}ms`
  if (Math.abs(ms) >= 0.001) return `${(ms * 1000).toFixed(1)}µs`
  return `${(ms * 1e6).toFixed(0)}ns`
}

const fmtInt = (n: number) => n.toLocaleString('en-US')

export function Playground() {
  return (
    // `profiling` makes the inspector's per-pass GPU timing real (timestamp-query) rather than
    // greyed out — the whole point of having the inspector on this page.
    //
    // Both components share this ONE provider, which is the project's founding claim made visible:
    // a timeline and a heatmap on the same page hold one GPUDevice, one frame loop and one submit
    // between them (§2a, §11.1). The inspector's "1 device, N surfaces" line is the receipt.
    <GPUProvider options={{ profiling: true }}>
      <Stage />
      <HeatmapStage />
      <GridStage />
      <ScatterStage />
    </GPUProvider>
  )
}

/** A 200x120 matrix with structure worth looking at: two gaussian hot spots over a gradient. */
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
  const ROWS = 120
  const COLS = 200
  const data = useMemo(() => buildMatrix(ROWS, COLS), [])
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 900, height: 320 })
  const [hovered, setHovered] = useState<number | null>(null)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setBox({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const [viewport, setViewport] = useState(() => ({
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
      <div {...stylex.props(s.heatHead)}>
        <span {...stylex.props(s.panelTitle)}>GPUHeatmap — the same runtime, a second component</span>
        <span {...stylex.props(s.readoutValue)}>
          {hoveredText ?? <span {...stylex.props(s.dim)}>hover a cell</span>}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.heatStage)}>
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
        This is the component PLAN.md §29 calls the architecture test: it was built to find out
        whether <code>@gpu-components/core</code> could host a second, differently-shaped component
        without changes. It needed exactly one — a second axis on the viewport — and that finding is
        recorded in <code>registry/heatmap/CORE-WISHLIST.md</code> rather than quietly patched.
      </p>
    </div>
  )
}

function Stage() {
  const { status } = useGpu()
  const [size, setSize] = useState<number>(10_000)
  const [shape, setShape] = useState<Shape>('bursty')
  const [trackCount, setTrackCount] = useState(8)

  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [brushCount, setBrushCount] = useState<number | null>(null)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 900, height: 420 })

  // GPUTimeline sizes itself from `viewport.width/height` (it has no ResizeObserver of its own —
  // the *parent* owns layout, per PLAN.md §11.1's "the DOM stays in charge of layout"), so
  // measuring the stage is this page's job.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setBox({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setBox({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const raw = useMemo(() => buildSpans(shape, size, trackCount), [shape, size, trackCount])
  const spans: SpanBuffers = useMemo(() => ingestSpans(raw), [raw])

  const initialViewport = useCallback(
    (): ViewportState => ({
      timeStart: 0,
      timeEnd: DOMAIN_MS,
      trackCount,
      width: box.width,
      height: box.height,
    }),
    [trackCount, box.width, box.height],
  )

  const [viewport, setViewport] = useState<ViewportState>(initialViewport)

  // Keep the viewport's pixel size in sync with the measured stage without disturbing the user's
  // current pan/zoom — resizing the window must not reset where you are in the trace.
  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  // A new dataset resets the domain: the old one's time range means nothing here.
  useEffect(() => {
    setViewport(initialViewport())
    setHovered(null)
    setSelected(null)
    setBrushCount(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the dataset only.
  }, [shape, size, trackCount])

  const visibleSpan = viewport.timeEnd - viewport.timeStart
  const zoom = DOMAIN_MS / Math.max(visibleSpan, 1e-9)
  const hoveredSpan = hovered != null ? spanDetail(spans, hovered) : null
  const selectedSpan = selected != null ? spanDetail(spans, selected) : null

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.controls)}>
        <Field label="Spans">
          <div {...stylex.props(s.segmented)}>
            {SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSize(n)}
                {...stylex.props(s.seg, size === n && s.segOn)}
              >
                {n >= 1000 ? `${n / 1000}k` : n}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Shape">
          <div {...stylex.props(s.segmented)}>
            {SHAPES.map((sh) => (
              <button
                key={sh}
                type="button"
                onClick={() => setShape(sh)}
                {...stylex.props(s.seg, shape === sh && s.segOn)}
              >
                {sh}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Tracks">
          <div {...stylex.props(s.segmented)}>
            {[4, 8, 16, 32].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTrackCount(n)}
                {...stylex.props(s.seg, trackCount === n && s.segOn)}
              >
                {n}
              </button>
            ))}
          </div>
        </Field>

        <button type="button" onClick={() => setViewport(initialViewport())} {...stylex.props(s.reset)}>
          Reset view
        </button>
      </div>

      <p {...stylex.props(s.blurb)}>{SHAPE_BLURB[shape]}</p>

      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'pending' && <div {...stylex.props(s.overlayMsg)}>Requesting a GPU device…</div>}
        {status === 'unsupported' && (
          <div {...stylex.props(s.overlayMsg)}>
            <strong {...stylex.props(s.strong)}>WebGPU is unavailable in this browser.</strong>
            <br />
            There is no Canvas2D fallback yet — PLAN.md §22 stages 3–5 are unbuilt, and this page
            says so rather than showing you an empty canvas and letting you guess.
          </div>
        )}
        {status === 'ready' && box.width > 1 && (
          <GPUTimeline
            spans={spans}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredId={hovered}
            selectedId={selected}
            onHover={setHovered}
            onSelect={setSelected}
            onBrushSelectionChange={(_rect, ids) => setBrushCount(ids.length)}
          />
        )}
      </div>

      <div {...stylex.props(s.hints)}>
        <Hint keys="drag ↔">pan</Hint>
        <Hint keys="wheel / trackpad ↕">zoom at the cursor</Hint>
        <Hint keys="click-drag">brush-select a region</Hint>
        <Hint keys="hover">inspect a span</Hint>
        <Hint keys="Tab then ← →">walk spans in a track</Hint>
        <Hint keys="↑ ↓">change track</Hint>
        <Hint keys="+ / -">zoom</Hint>
        <Hint keys="Home / End">first / last span</Hint>
      </div>

      <div {...stylex.props(s.panels)}>
        <div {...stylex.props(s.panel)}>
          <div {...stylex.props(s.panelTitle)}>View</div>
          <Readout label="Domain">
            {fmtMs(viewport.timeStart)} → {fmtMs(viewport.timeEnd)}
          </Readout>
          <Readout label="Visible">{fmtMs(visibleSpan)}</Readout>
          <Readout label="Zoom">{zoom < 10 ? `${zoom.toFixed(2)}×` : `${fmtInt(Math.round(zoom))}×`}</Readout>
          <Readout label="Spans">{fmtInt(spans.count)}</Readout>
          <Readout label="Canvas">
            {Math.round(box.width)} × {Math.round(box.height)}
          </Readout>
        </div>

        <div {...stylex.props(s.panel)}>
          <div {...stylex.props(s.panelTitle)}>Interaction</div>
          <Readout label="Hovered">{hoveredSpan ?? <span {...stylex.props(s.dim)}>—</span>}</Readout>
          <Readout label="Selected">{selectedSpan ?? <span {...stylex.props(s.dim)}>—</span>}</Readout>
          <Readout label="Brushed">
            {brushCount == null ? (
              <span {...stylex.props(s.dim)}>—</span>
            ) : (
              `${fmtInt(brushCount)} spans`
            )}
          </Readout>
          <p {...stylex.props(s.note)}>
            Hover and click are an exact CPU binary search (§9.5), not GPU picking — no frame of
            latency. The brush highlight is a GPU bitset: selecting 100k spans is one dispatch, not
            a JS loop.
          </p>
        </div>

        <div {...stylex.props(s.panel, s.inspectorPanel)}>
          <div {...stylex.props(s.panelTitle)}>Inspector</div>
          <div {...stylex.props(s.inspector)}>
            <GpuInspector />
          </div>
        </div>
      </div>

      <p {...stylex.props(s.footnote)}>
        Zoom far enough out on the larger datasets and the component switches from drawing every
        span to a GPU-binned density field (§12.2&apos;s two-mode frame). The switch is deliberately
        invisible — if you can spot the moment it happens, that is a bug worth reporting.
      </p>
    </div>
  )
}

/**
 * One-line description of a span, read from the same buffers the shader draws. Ids are indices into
 * the *ingested* (track, start)-sorted arrays, not into the raw input — `SpanBuffers` carries the
 * labels through that sort, so there is no mapping back to do.
 */
function spanDetail(spans: SpanBuffers, id: number): string | null {
  if (id < 0 || id >= spans.count) return null
  const label = spans.labels[id] ?? `#${id}`
  return `${label} · ${fmtMs(spans.duration[id]!)} · track ${spans.track[id]}`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div {...stylex.props(s.field)}>
      <span {...stylex.props(s.fieldLabel)}>{label}</span>
      {children}
    </div>
  )
}

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div {...stylex.props(s.readout)}>
      <span {...stylex.props(s.readoutLabel)}>{label}</span>
      <span {...stylex.props(s.readoutValue)}>{children}</span>
    </div>
  )
}

function Hint({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <span {...stylex.props(s.hint)}>
      <kbd {...stylex.props(s.kbd)}>{keys}</kbd>
      {children}
    </span>
  )
}

const CLUSTERS = [
  { cx: 0.25, cy: 0.7, spread: 0.09, category: 0 },
  { cx: 0.62, cy: 0.35, spread: 0.13, category: 1 },
  { cx: 0.8, cy: 0.75, spread: 0.06, category: 2 },
]

function ScatterStage() {
  const { status } = useGpu()
  const POINTS = 250_000
  const data = useMemo(() => {
    const rnd = mulberry32(0x5ca7)
    const x = new Float32Array(POINTS)
    const y = new Float32Array(POINTS)
    const category = new Uint8Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      const cluster = CLUSTERS[i % CLUSTERS.length]!
      // Box-Muller, so the clusters look like real measurements rather than uniform blobs.
      const u = Math.max(rnd(), 1e-9)
      const v = rnd()
      const r = Math.sqrt(-2 * Math.log(u)) * cluster.spread
      x[i] = cluster.cx + r * Math.cos(2 * Math.PI * v)
      y[i] = cluster.cy + r * Math.sin(2 * Math.PI * v)
      category[i] = cluster.category
    }
    return ingestColumns(x, y, category, ['baseline', 'canary', 'control'])
  }, [])

  const stageRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 900, height: 400 })
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setBox({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const [viewport, setViewport] = useState(() => ({
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

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.heatHead)}>
        <span {...stylex.props(s.panelTitle)}>GPUScatter — 250,000 points, one draw call</span>
        <span {...stylex.props(s.readoutValue)}>
          {selected != null ? `${fmtInt(selected)} selected` : hovered != null ? `point ${fmtInt(hovered)}` : <span {...stylex.props(s.dim)}>hover or drag to brush</span>}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.heatStage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUScatter
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredIndex={hovered}
            onHover={setHovered}
            onBrushSelection={(ids) => setSelected(ids.length)}
            pointSizePx={3}
            aria-label="Latency scatter"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">zoom both axes at the cursor</Hint>
        <Hint keys="drag">brush-select</Hint>
        <Hint keys="hover">inspect a point</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        The purest form of the argument on this page: 250,000 points, one instanced draw call, and
        the CPU touches none of them after upload. Zooming is a 64-byte uniform write. Hover is an
        exact same-frame lookup through a uniform grid built once — which is worth noting because
        PLAN.md §9.5 routes a dense scatter to <em>asynchronous GPU picking</em> on the grounds that
        it has no cheap CPU index. It has one, and the plan now says so.
      </p>
    </div>
  )
}

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

  const stageRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 900, height: 380 })
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setBox({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const VISIBLE_ROWS = 16
  const [viewport, setViewport] = useState(() => ({
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
      <div {...stylex.props(s.heatHead)}>
        <span {...stylex.props(s.panelTitle)}>GPUDataGrid — the flagship, built last on purpose</span>
        <span {...stylex.props(s.readoutValue)}>
          {selected == null ? <span {...stylex.props(s.dim)}>click a row</span> : `row ${selected}`}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.gridStage)}>
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

const s = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: 14 },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  segmented: {
    display: 'flex',
    gap: 2,
    padding: 2,
    backgroundColor: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  seg: {
    fontFamily: font.mono,
    fontSize: 12,
    padding: '5px 10px',
    color: color.textDim,
    backgroundColor: { default: 'transparent', ':hover': color.surface2 },
    border: 'none',
    borderRadius: radius.sm,
    cursor: 'pointer',
  },
  segOn: { color: color.onAccent, backgroundColor: { default: color.accent, ':hover': color.accent } },
  reset: {
    fontFamily: font.mono,
    fontSize: 12,
    padding: '7px 12px',
    color: color.textDim,
    backgroundColor: { default: color.surface, ':hover': color.surface2 },
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    cursor: 'pointer',
  },
  blurb: { margin: 0, fontSize: 13, color: color.textDim },
  stage: {
    position: 'relative',
    height: 440,
    minHeight: 440,
    overflow: 'hidden',
    backgroundColor: color.bgRaised,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  overlayMsg: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 1.6,
    color: color.textDim,
  },
  strong: { color: color.text },
  hints: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 12, color: color.textFaint },
  hint: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  kbd: {
    fontFamily: font.mono,
    fontSize: 11,
    padding: '2px 6px',
    color: color.textDim,
    backgroundColor: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  panels: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 14,
    backgroundColor: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  inspectorPanel: { gridColumn: { default: 'auto', '@media (min-width: 900px)': 'span 1' } },
  panelTitle: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: color.textFaint,
    marginBottom: 4,
  },
  readout: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 },
  readoutLabel: { color: color.textFaint },
  readoutValue: { fontFamily: font.mono, color: color.text, textAlign: 'right', wordBreak: 'break-word' },
  dim: { color: color.textFaint },
  note: { margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.6, color: color.textFaint },
  inspector: { fontSize: 11, fontFamily: font.mono, color: color.textDim, overflowX: 'auto' },
  footnote: { margin: 0, fontSize: 12.5, lineHeight: 1.7, color: color.textFaint },
  heatHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' },
  gridStage: {
    position: 'relative',
    height: 380,
    minHeight: 380,
    overflow: 'hidden',
    backgroundColor: color.bgRaised,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
  heatStage: {
    position: 'relative',
    height: 320,
    minHeight: 320,
    overflow: 'hidden',
    backgroundColor: color.bgRaised,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
  },
})
