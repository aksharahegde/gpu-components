'use client'

import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GPUProvider, GpuInspector, useGpu } from '@gpuc/react'
import type { ViewportState } from '@gpuc/core'
import { GPUTimeline, ingestSpans, type RawSpan, type SpanBuffers } from '../../../../../registry/timeline'
import { Field, fmtInt, fmtMs, Hint, mulberry32, PROVIDER_OPTIONS, Readout, s, useMeasuredStage } from './chrome'

const SIZES = [1_000, 10_000, 100_000, 500_000] as const
const SHAPES = ['bursty', 'shallow-wide', 'flame-graph'] as const
type Shape = (typeof SHAPES)[number]

const SHAPE_BLURB: Record<Shape, string> = {
  bursty: 'Realistic trace clustering — dense knots separated by quiet gaps.',
  'shallow-wide': 'Many tracks, little nesting. The width-bound case.',
  'flame-graph':
    'A real call tree, not a look-alike: every child span sits strictly inside its parent’s ' +
    'time window, depth is track, and same function always gets the same color. PLAN.md §6.2 ' +
    'treats a flame graph as this component with different data, not a separate one — this is that claim, shown.',
}

/** Deterministic PRNG, so the dataset you are looking at is the dataset anyone else sees. */
const NAMES = [
  'fetchUser', 'db.query', 'render', 'serialize', 'auth.verify', 'cache.get',
  'llm.completion', 'tool.call', 'parse', 'compress', 'net.write', 'index.scan',
]

/** Total domain, in milliseconds — a 60-second trace, so zooming to a single span is a real journey. */
const DOMAIN_MS = 60_000

/**
 * Simulates a real call stack via DFS, rather than picking `(track, start, duration)`
 * independently per span — that scatter looks deep but never actually nests: nothing here
 * guarantees a "child" sits inside its "parent's" time window. This does: `call()` only ever
 * spends time inside the window its own caller gave it, so track (call depth) and time are
 * never in conflict, which is the one property that makes something a flame graph instead of
 * just a lot of short spans on many tracks.
 */
function buildFlameGraph(rnd: () => number, size: number, trackCount: number): RawSpan[] {
  const spans: RawSpan[] = [];

  function call(start: number, duration: number, depth: number): void {
    if (spans.length >= size) return;
    const nameIndex = Math.floor(rnd() * NAMES.length);
    // Same function, same color everywhere it appears — the convention every real flame graph
    // tool uses, and free here because `colorIndex` already exists for the highlight/palette path.
    spans.push({ start, duration, track: depth, label: NAMES[nameIndex], colorIndex: nameIndex });
    if (depth + 1 >= trackCount || duration < 0.1) return;

    // Split this call's own duration into "self time" (gaps between children, and after the
    // last one) and "children time" (recursive calls) — the two things a flame graph shows.
    const childCount = 1 + Math.floor(rnd() * 3);
    const childrenBudget = duration * (0.3 + rnd() * 0.5);
    const selfTimeBudget = duration - childrenBudget;
    const gap = () => (selfTimeBudget * rnd()) / (childCount + 1);

    let cursor = start + gap();
    let remaining = childrenBudget;
    for (let c = 0; c < childCount && remaining > 0.1 && spans.length < size; c++) {
      const isLast = c === childCount - 1;
      const childDuration = isLast ? remaining : remaining * (0.2 + rnd() * 0.6);
      if (cursor + childDuration > start + duration) break; // never overrun the parent
      call(cursor, childDuration, depth + 1);
      cursor += childDuration + gap();
      remaining -= childDuration;
    }
  }

  // Root calls tile the domain like independent requests, each its own trace.
  let t = 0;
  while (t < DOMAIN_MS && spans.length < size) {
    const duration = 200 + rnd() * 1800;
    call(t, duration, 0);
    t += duration + rnd() * 100;
  }
  return spans;
}

function buildSpans(shape: Shape, size: number, trackCount: number): RawSpan[] {
  const rnd = mulberry32(0x5eed)

  if (shape === 'flame-graph') return buildFlameGraph(rnd, size, trackCount)

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
    } else {
      start = rnd() * DOMAIN_MS
      duration = rnd() * 12 + 0.05
      track = Math.floor(rnd() * trackCount)
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

function spanDetail(spans: SpanBuffers, id: number): string | null {
  if (id < 0 || id >= spans.count) return null
  const label = spans.labels[id] ?? `#${id}`
  return `${label} · ${fmtMs(spans.duration[id]!)} · track ${spans.track[id]}`
}

function Stage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 440 })
  const [size, setSize] = useState<number>(10_000)
  const [shape, setShape] = useState<Shape>('bursty')
  const [trackCount, setTrackCount] = useState(8)

  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [brushCount, setBrushCount] = useState<number | null>(null)
  // Canvas2D fallback readout (PLAN.md §22, stage 5.2) — `onPerformance` reuses the existing
  // warnings channel, so this is the only state this page needs to add.
  const [degradedReason, setDegradedReason] = useState<string | null>(null)


  // GPUTimeline sizes itself from `viewport.width/height` (it has no ResizeObserver of its own —
  // the *parent* owns layout, per PLAN.md §11.1's "the DOM stays in charge of layout"), so
  // measuring the stage is this page's job.

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
            <strong {...stylex.props(s.strong)}>WebGPU is unavailable, and no fallback was requested.</strong>
          </div>
        )}
        {(status === 'ready' || status === 'fallback') && box.width > 1 && (
          <GPUTimeline
            spans={spans}
            viewport={viewport}
            onViewportChange={setViewport}
            hoveredId={hovered}
            selectedId={selected}
            onHover={setHovered}
            onSelect={setSelected}
            onBrushSelectionChange={(_rect, ids) => setBrushCount(ids.length)}
            onPerformance={(m) => setDegradedReason(m.reason)}
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
          <Readout label="Backend">
            {status === 'fallback' ? (
              <span {...stylex.props(s.strong)}>Canvas2D fallback (no WebGPU)</span>
            ) : (
              'WebGPU'
            )}
          </Readout>
          {degradedReason && (
            <p {...stylex.props(s.note)}>Canvas2D degraded: {degradedReason}</p>
          )}
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
            Hover and click are an exact CPU binary search, not GPU picking — no frame of
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
        span to a GPU-binned density field. The switch is deliberately invisible: if you can spot
        the moment it happens, it is not working.
      </p>
    </div>
  )
}

/**
 * One-line description of a span, read from the same buffers the shader draws. Ids are indices into
 * the *ingested* (track, start)-sorted arrays, not into the raw input — `SpanBuffers` carries the
 * labels through that sort, so there is no mapping back to do.
 */

export function TimelineDemo() {
  return (
    // Each page owns one provider, so one device serves that page's component.
    <GPUProvider options={PROVIDER_OPTIONS}>
      <Stage />
    </GPUProvider>
  )
}
