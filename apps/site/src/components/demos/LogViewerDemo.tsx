'use client'

import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPULogViewer, generateLogLines } from '../../../../../registry/logviewer'
import type { LogLine, LogSource } from '../../../../../registry/logviewer'
import { Btn, Dim, Field, Hint, fmtInt, s, useMeasuredStage } from './chrome'

/** Backlog size. A million lines is the claim; this is what actually goes in the ring. */
const BACKLOG = 500_000
const LINE_HEIGHT = 15
/** New lines per tick while streaming, so "tailing" looks like a busy service rather than a trickle. */
const TICK_LINES = 12

function LogViewerStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 440 })

  /**
   * The stream lives in a ref and is mutated in place.
   *
   * This is the shape `LogSource` exists for. Appending to half a million lines by allocating a new
   * half-million-line array every tick would cost more on the CPU than the whole component saves,
   * so the host owns the array and bumps a version to tell React something changed.
   */
  const linesRef = useRef<LogLine[]>([])
  const [version, setVersion] = useState(0)
  if (linesRef.current.length === 0) {
    linesRef.current = generateLogLines(BACKLOG, Date.now() - BACKLOG * 20)
  }

  const source: LogSource = useMemo(
    () => ({ lines: linesRef.current, version }),
    [version],
  )

  const [streaming, setStreaming] = useState(false)
  const [follow, setFollow] = useState(true)
  const [queryText, setQueryText] = useState('')
  const [selected, setSelected] = useState<number | null>(null)

  // Append on an interval rather than every frame: real logs arrive on their own schedule, and a
  // per-frame append would measure this demo's generator rather than the component.
  useEffect(() => {
    if (!streaming) return
    const timer = setInterval(() => {
      const at = linesRef.current
      const last = at[at.length - 1]
      at.push(...generateLogLines(TICK_LINES, (last?.timestamp ?? Date.now()) + 20, at.length))
      setVersion((v) => v + 1)
    }, 120)
    return () => clearInterval(timer)
  }, [streaming])

  const query = useMemo(() => ({ text: queryText }), [queryText])

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0, timeEnd: 1, trackCount: 1,
    rowStart: 0, rowEnd: 1, yContinuous: true,
    width: box.width, height: box.height,
  }))
  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  const onFollowChange = useCallback((next: boolean) => setFollow(next), [])

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>
          GPULogViewer — {fmtInt(source.lines.length)} lines resident on the GPU
        </span>
        <span {...stylex.props(s.readoutValue)}>
          {selected !== null ? `line ${fmtInt(selected)}` : <Dim>click a line</Dim>}
        </span>
      </div>

      <div {...stylex.props(s.controls)}>
        <Field label="Search">
          <input
            type="search"
            value={queryText}
            placeholder="pool, timeout, cache…"
            aria-label="Filter log lines"
            onChange={(e) => setQueryText(e.target.value)}
            {...stylex.props(s.readoutValue)}
          />
        </Field>
        <Btn onClick={() => setStreaming((v) => !v)}>{streaming ? 'Stop stream' : 'Start stream'}</Btn>
        <Btn onClick={() => setFollow((v) => !v)}>{follow ? 'Following' : 'Not following'}</Btn>
      </div>

      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPULogViewer
            source={source}
            viewport={viewport}
            lineHeight={LINE_HEIGHT}
            query={query}
            follow={follow}
            onFollowChange={onFollowChange}
            selectedLine={selected}
            onSelectLine={setSelected}
            aria-label="Service log"
          />
        )}
      </div>

      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">scroll (scrolling up stops following)</Hint>
        <Hint keys="click">select a line</Hint>
        <Hint keys="↑ ↓ PgUp PgDn Home End">keyboard scroll</Hint>
      </div>

      <p {...stylex.props(s.footnote)}>
        The first component here whose dataset has a <em>tail</em>. Everything else uploads an
        immutable dataset once; this one appends, so it is built on core’s new <code>RingBuffer</code>
        and writes one 8-byte record per line at a computed offset instead of re-uploading the
        buffer. The strip down the right edge is the payoff: match and error density across all{' '}
        {fmtInt(source.lines.length)} lines, reduced by a compute pass over every record rather than
        the ~29 on screen — the question a CPU cannot answer on the main thread. The glyphs are{' '}
        <em>not</em> on the GPU, and that is measured rather than assumed: per-run Canvas2D text
        measured at 0.1ms for a window this size, with no crossover point where a glyph atlas would
        win.
      </p>
    </div>
  )
}

/** Stable identity: a fresh object each render trips GPUProvider's "options changed" warning. */
const PROVIDER_OPTIONS = { profiling: true }

export function LogViewerDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <LogViewerStage />
    </GPUProvider>
  )
}
