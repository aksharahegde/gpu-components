'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { GPUProvider, useGpu } from '@gpu-components/react'
import { GPUTimeline, ingestSpans, type RawSpan } from '../../../../registry/timeline'
import { color, font, radius } from '../tokens.stylex'
import type { SX } from '../ui'

/** Inlined rather than shared — see `ui.tsx`'s equivalent comment. */
const SM = '@media (max-width: 620px)'

/**
 * A live, honest demonstration of the ceiling this project exists to break.
 *
 * It renders the *zoomed-out* case from the plan: every span in the dataset is
 * on screen, so every span must be drawn every frame. That is the scenario where
 * a trace timeline actually falls over, and it is the scenario a GPU instanced
 * draw collapses into a single call.
 *
 * Everything reported here is measured in the visitor's browser, right now,
 * including the WebGPU row — it renders through the real, in-progress
 * `GPUTimeline` component (`registry/timeline`), not a placeholder.
 */

type Mode = 'dom' | 'canvas' | 'webgpu'

const TRACKS = 8
const DOM_CAP = 20_000
const COLORS = ['#8b9dff', '#5be9b9', '#f0b072', '#f08a8a', '#7fd8f0', '#b7a4ff']

/** Deterministic PRNG so every visitor benchmarks the identical dataset. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Dataset = {
  t0: Float64Array
  dur: Float64Array
  track: Uint8Array
  /** span indices grouped by colour bucket, so Canvas2D pays minimal state changes */
  buckets: Uint32Array[]
}

function buildDataset(count: number): Dataset {
  const rnd = mulberry32(0x5eed)
  const t0 = new Float64Array(count)
  const dur = new Float64Array(count)
  const track = new Uint8Array(count)
  const bucketLists: number[][] = COLORS.map(() => [])

  for (let i = 0; i < count; i++) {
    // Bursty clustering: realistic traces are not uniform.
    const burst = Math.floor(rnd() * 240)
    t0[i] = (burst / 240) * 0.94 + rnd() * 0.06
    dur[i] = Math.pow(rnd(), 3) * 0.02 + 0.00004
    track[i] = Math.floor(rnd() * TRACKS)
    bucketLists[Math.floor(rnd() * COLORS.length)]!.push(i)
  }
  return { t0, dur, track, buckets: bucketLists.map((l) => Uint32Array.from(l)) }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[i]!
}

const s = stylex.create({
  root: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 18,
    padding: '16px 20px',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
    backgroundColor: color.bgRaised,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 190 },
  fieldTight: { minWidth: 0 },
  fieldGrow: { flex: 1 },
  label: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  amber: { color: color.amber },
  seg: {
    display: 'inline-flex',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.bg,
  },
  segBtn: {
    borderWidth: 0,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: color.borderStrong,
    backgroundColor: { default: 'transparent', ':hover': color.surface },
    color: { default: color.textDim, ':hover': color.text },
    fontFamily: font.mono,
    fontSize: 12.5,
    paddingBlock: 7,
    paddingInline: 13,
    cursor: 'pointer',
  },
  segBtnLast: { borderInlineEndWidth: 0 },
  segBtnOnDom: {
    backgroundColor: color.rose,
    color: color.onAccent,
    fontWeight: 600,
  },
  segBtnOnCanvas: {
    backgroundColor: color.amber,
    color: color.onAccent,
    fontWeight: 600,
  },
  segBtnOnWebgpu: {
    backgroundColor: color.accent,
    color: color.onAccent,
    fontWeight: 600,
  },
  segBtnOff: { opacity: 0.42, cursor: 'not-allowed' },
  range: { accentColor: color.accent, width: '100%' },
  pauseBtn: {
    alignSelf: 'flex-end',
    paddingBlock: 8,
    paddingInline: 14,
    fontSize: 13.5,
    fontFamily: font.mono,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.borderStrong, ':hover': color.borderHover },
    borderRadius: radius.md,
    backgroundColor: { default: color.surface, ':hover': color.surface2 },
    color: color.text,
    cursor: 'pointer',
  },
  stage: {
    position: 'relative',
    height: 236,
    backgroundColor: color.bg,
    overflow: 'hidden',
    contain: 'strict',
  },
  canvas: { display: 'block', width: '100%', height: '100%' },
  domLayer: { position: 'absolute', inset: 0, overflow: 'hidden' },
  hidden: { display: 'none' },
  gpuNotice: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    textAlign: 'center',
    fontFamily: font.mono,
    fontSize: 13,
    color: color.textDim,
  },
  span: { position: 'absolute', borderRadius: 2, willChange: 'transform' },
  readout: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(4, minmax(0, 1fr))',
      [SM]: 'repeat(2, minmax(0, 1fr))',
    },
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  stat: {
    padding: '14px 18px',
    borderInlineEndWidth: 1,
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: color.border,
  },
  statLast: { borderInlineEndWidth: 0 },
  statLabel: {
    fontFamily: font.mono,
    fontSize: 10.5,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  statValue: {
    fontFamily: font.mono,
    fontSize: 21,
    color: color.text,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
  },
  good: { color: color.mint },
  warn: { color: color.amber },
  bad: { color: color.rose },
})

export function SpanBenchmark() {
  const [mode, setMode] = useState<Mode>('canvas')
  const [exp, setExp] = useState(4.0) // log10 span count
  const [running, setRunning] = useState(true)

  const requested = Math.round(Math.pow(10, exp) / 100) * 100
  const capped = mode === 'dom' ? Math.min(requested, DOM_CAP) : requested

  const [stats, setStats] = useState({ fps: 0, p50: 0, p95: 0, dropped: 0 })

  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const domLayerRef = useRef<HTMLDivElement | null>(null)
  const poolRef = useRef<HTMLDivElement[]>([])

  const data = useMemo(() => buildDataset(capped), [capped])

  // Pause when scrolled out of view — a benchmark that burns CPU off-screen is
  // exactly the kind of thing this project's docs tell you not to ship.
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting ?? true), {
      threshold: 0.05,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Rebuild the DOM node pool when the mode or the count changes. These nodes are
  // created imperatively, so they take the compiled class name directly; per-node
  // values stay on `.style` because they differ for every element.
  useEffect(() => {
    const layer = domLayerRef.current
    if (!layer) return
    layer.textContent = ''
    poolRef.current = []
    if (mode !== 'dom') return

    const spanClass = stylex.props(s.span).className ?? ''
    const frag = document.createDocumentFragment()
    const pool: HTMLDivElement[] = new Array(capped)
    for (let i = 0; i < capped; i++) {
      const d = document.createElement('div')
      d.className = spanClass
      d.style.background = COLORS[i % COLORS.length]!
      d.style.height = '13px'
      pool[i] = d
      frag.appendChild(d)
    }
    layer.appendChild(frag)
    poolRef.current = pool
    return () => {
      layer.textContent = ''
      poolRef.current = []
    }
  }, [mode, capped])

  useEffect(() => {
    // WebGPU mode drives its own render loop (GPUTimeline's runtime) and its own
    // stats measurement, in WebGpuStage below — this effect only covers dom/canvas.
    if (!running || !visible || mode === 'webgpu') return
    let raf = 0
    let last = performance.now()
    const acc: number[] = []
    let dropped = 0
    let lastReport = last
    const start = last

    const draw = (now: number) => {
      const dt = now - last
      last = now

      const host = hostRef.current
      const W = host?.clientWidth ?? 800
      const H = host?.clientHeight ?? 236
      const rowH = H / TRACKS

      // A slow zoom oscillation so every frame is genuine work, never a cached
      // repaint. Amplitude is small; the whole dataset stays on screen.
      const phase = (now - start) / 3600
      const zoom = 1 + Math.sin(phase) * 0.06
      const pan = Math.sin(phase * 0.7) * 0.02

      if (mode === 'canvas') {
        const cv = canvasRef.current
        const ctx = cv?.getContext('2d', { alpha: false })
        if (cv && ctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2)
          const pw = Math.round(W * dpr)
          const ph = Math.round(H * dpr)
          if (cv.width !== pw || cv.height !== ph) {
            cv.width = pw
            cv.height = ph
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.fillStyle = '#08090b'
          ctx.fillRect(0, 0, W, H)

          // Grouped by colour: the *optimised* Canvas2D approach, so the
          // comparison is fair rather than flattering to us.
          for (let b = 0; b < data.buckets.length; b++) {
            ctx.fillStyle = COLORS[b]!
            const idx = data.buckets[b]!
            for (let j = 0; j < idx.length; j++) {
              const i = idx[j]!
              const x = (data.t0[i]! * zoom + pan) * W
              let w = data.dur[i]! * zoom * W
              if (w < 0.75) w = 0.75
              if (x > W || x + w < 0) continue
              ctx.fillRect(x, data.track[i]! * rowH + 4, w, 13)
            }
          }
        }
      } else {
        const pool = poolRef.current
        for (let i = 0; i < pool.length; i++) {
          const x = (data.t0[i]! * zoom + pan) * W
          let w = data.dur[i]! * zoom * W
          if (w < 0.75) w = 0.75
          const el = pool[i]!
          if (x > W || x + w < 0) {
            if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
            continue
          }
          if (el.style.visibility === 'hidden') el.style.visibility = ''
          el.style.transform = `translate(${x.toFixed(1)}px, ${(data.track[i]! * rowH + 4).toFixed(1)}px)`
          el.style.width = `${w.toFixed(1)}px`
        }
      }

      // Discard the first handful of frames: they include layout and allocation.
      if (now - start > 400) {
        acc.push(dt)
        if (dt > (1000 / 60) * 1.5) dropped++
        if (acc.length > 90) acc.shift()
      }

      if (now - lastReport > 380 && acc.length > 8) {
        lastReport = now
        const sorted = [...acc].sort((a, b) => a - b)
        const p50 = percentile(sorted, 50)
        setStats({ fps: p50 > 0 ? 1000 / p50 : 0, p50, p95: percentile(sorted, 95), dropped })
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [mode, data, running, visible, capped])

  // Reset the accumulated statistics whenever the experiment changes.
  useEffect(() => setStats({ fps: 0, p50: 0, p95: 0, dropped: 0 }), [mode, capped])

  const fpsTone =
    stats.fps === 0 ? null : stats.fps >= 55 ? s.good : stats.fps >= 25 ? s.warn : s.bad

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.controls)}>
        <div {...stylex.props(s.field, s.fieldTight)}>
          <span {...stylex.props(s.label)} id="bench-renderer">
            Renderer
          </span>
          <div {...stylex.props(s.seg)} role="group" aria-labelledby="bench-renderer">
            <button
              onClick={() => setMode('dom')}
              aria-pressed={mode === 'dom'}
              {...stylex.props(s.segBtn, mode === 'dom' && s.segBtnOnDom)}
            >
              DOM
            </button>
            <button
              onClick={() => setMode('canvas')}
              aria-pressed={mode === 'canvas'}
              {...stylex.props(s.segBtn, mode === 'canvas' && s.segBtnOnCanvas)}
            >
              Canvas2D
            </button>
            <button
              onClick={() => setMode('webgpu')}
              aria-pressed={mode === 'webgpu'}
              {...stylex.props(s.segBtn, s.segBtnLast, mode === 'webgpu' && s.segBtnOnWebgpu)}
            >
              WebGPU
            </button>
          </div>
        </div>

        <div {...stylex.props(s.field, s.fieldGrow)}>
          <label {...stylex.props(s.label)} htmlFor="bench-count">
            Spans — {requested.toLocaleString()}
            {capped < requested && (
              <span {...stylex.props(s.amber)}> · DOM capped at {DOM_CAP.toLocaleString()}</span>
            )}
          </label>
          <input
            id="bench-count"
            type="range"
            min={2.7}
            max={5.3}
            step={0.05}
            value={exp}
            onChange={(e) => setExp(Number(e.target.value))}
            {...stylex.props(s.range)}
          />
        </div>

        <button onClick={() => setRunning((r) => !r)} {...stylex.props(s.pauseBtn)}>
          {running ? 'Pause' : 'Run'}
        </button>
      </div>

      <div {...stylex.props(s.stage)} ref={hostRef}>
        {mode === 'canvas' ? (
          <canvas
            ref={canvasRef}
            aria-label="Canvas2D span rendering benchmark"
            role="img"
            {...stylex.props(s.canvas)}
          />
        ) : null}
        {mode === 'webgpu' ? (
          <WebGpuStage
            data={data}
            capped={capped}
            running={running}
            visible={visible}
            hostRef={hostRef}
            onStats={setStats}
          />
        ) : null}
        <div
          ref={domLayerRef}
          aria-hidden="true"
          {...stylex.props(s.domLayer, mode !== 'dom' && s.hidden)}
        />
      </div>

      <div {...stylex.props(s.readout)}>
        <Stat label="Frames / sec" value={stats.fps ? stats.fps.toFixed(0) : '—'} tone={fpsTone} />
        <Stat label="p50 frame" value={stats.p50 ? `${stats.p50.toFixed(1)}ms` : '—'} />
        <Stat label="p95 frame" value={stats.p95 ? `${stats.p95.toFixed(1)}ms` : '—'} />
        <Stat label="Spans drawn" value={capped.toLocaleString()} last />
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  last,
}: {
  label: string
  value: string
  tone?: SX
  last?: boolean
}) {
  return (
    <div {...stylex.props(s.stat, last && s.statLast)}>
      <div {...stylex.props(s.statLabel)}>{label}</div>
      <div {...stylex.props(s.statValue, tone)}>{value}</div>
    </div>
  )
}

/** `Dataset`'s columnar arrays, unpacked into the plain objects `ingestSpans` sorts by
 * (track, start). No labels: at this zoom level (every span on screen) every span is
 * already narrower than the DOM label budget, same as the dom/canvas renderings above,
 * which draw unlabelled coloured blocks too. */
function datasetToRawSpans(data: Dataset, count: number): RawSpan[] {
  const spans: RawSpan[] = new Array(count)
  for (let i = 0; i < count; i++) {
    spans[i] = {
      start: data.t0[i]!,
      duration: data.dur[i]!,
      track: data.track[i]!,
      colorIndex: i % COLORS.length,
    }
  }
  return spans
}

/**
 * Owns the `<GPUProvider>` so a WebGPU device is only ever requested once a visitor
 * actually selects this mode — never eagerly on page load.
 */
function WebGpuStage(props: {
  data: Dataset
  capped: number
  running: boolean
  visible: boolean
  hostRef: RefObject<HTMLDivElement | null>
  onStats: (stats: { fps: number; p50: number; p95: number; dropped: number }) => void
}) {
  const spans = useMemo(() => ingestSpans(datasetToRawSpans(props.data, props.capped)), [props.data, props.capped])
  return (
    <GPUProvider>
      <WebGpuTimelineInner
        spans={spans}
        running={props.running}
        visible={props.visible}
        hostRef={props.hostRef}
        onStats={props.onStats}
      />
    </GPUProvider>
  )
}

function WebGpuTimelineInner(props: {
  spans: ReturnType<typeof ingestSpans>
  running: boolean
  visible: boolean
  hostRef: RefObject<HTMLDivElement | null>
  onStats: (stats: { fps: number; p50: number; p95: number; dropped: number }) => void
}) {
  const { status } = useGpu()
  const [viewport, setViewport] = useState(() => ({
    timeStart: 0,
    timeEnd: 1,
    trackCount: TRACKS,
    width: props.hostRef.current?.clientWidth ?? 800,
    height: props.hostRef.current?.clientHeight ?? 236,
  }))
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Tracks the stage's own size (it's flex-responsive) without touching pan/zoom — real pan/zoom
  // now comes from the visitor's own wheel input, via GPUTimeline's onViewportChange below.
  useEffect(() => {
    const host = props.hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setViewport((v) =>
        v.width === rect.width && v.height === rect.height
          ? v
          : { ...v, width: rect.width, height: rect.height },
      )
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [props.hostRef])

  // Same measurement methodology as the dom/canvas modes above: wall-clock deltas between
  // consecutive requestAnimationFrame callbacks. It runs alongside GPUTimeline's own render
  // loop (owned by its GpuRuntime, not by this component — React never owns GPU state), so a
  // slow GPU frame delays this callback exactly as it would any other main-thread work.
  useEffect(() => {
    if (!props.running || !props.visible || status !== 'ready') return
    let raf = 0
    let last = performance.now()
    const acc: number[] = []
    let dropped = 0
    let lastReport = last
    const start = last

    const tick = (now: number) => {
      const dt = now - last
      last = now

      if (now - start > 400) {
        acc.push(dt)
        if (dt > (1000 / 60) * 1.5) dropped++
        if (acc.length > 90) acc.shift()
      }

      if (now - lastReport > 380 && acc.length > 8) {
        lastReport = now
        const sorted = [...acc].sort((a, b) => a - b)
        const p50 = percentile(sorted, 50)
        props.onStats({ fps: p50 > 0 ? 1000 / p50 : 0, p50, p95: percentile(sorted, 95), dropped })
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStats is a stable identity from the parent.
  }, [props.running, props.visible, status])

  if (status === 'unsupported') {
    return (
      <div {...stylex.props(s.gpuNotice)}>
        WebGPU is not available in this browser — try a recent Chrome, Edge, or Safari.
      </div>
    )
  }
  if (status === 'pending') {
    return <div {...stylex.props(s.gpuNotice)}>Requesting a GPU device…</div>
  }
  return (
    <GPUTimeline
      spans={props.spans}
      viewport={viewport}
      onViewportChange={setViewport}
      hoveredId={hoveredId}
      selectedId={selectedId}
      onHover={setHoveredId}
      onSelect={setSelectedId}
    />
  )
}
