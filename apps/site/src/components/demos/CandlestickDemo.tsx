'use client'

import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUCandlestick, aggregateTicks, generateBars } from '../../../../../registry/candlestick'
import type { Bar, BarSource } from '../../../../../registry/candlestick'
import { Btn, Dim, Field, Hint, fmtInt, s, useMeasuredStage } from './chrome'

const HISTORY = 200_000
const INTERVAL_MS = 60_000

function CandlestickStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 460 })

  // Mutated in place and versioned — the shape BarSource exists for. See LogViewerDemo for the
  // same reasoning: reallocating a 200,000-element array per tick costs more than the GPU saves.
  const barsRef = useRef<Bar[]>([])
  const [version, setVersion] = useState(0)
  const [openBar, setOpenBar] = useState(false)
  if (barsRef.current.length === 0) {
    barsRef.current = generateBars(HISTORY, Date.now() - HISTORY * INTERVAL_MS)
  }

  const source: BarSource = useMemo(
    () => ({ bars: barsRef.current, version, openBar }),
    [version, openBar],
  )

  const [streaming, setStreaming] = useState(false)
  const [follow, setFollow] = useState(true)
  const [pitch, setPitch] = useState(6)
  const [hover, setHover] = useState<{ index: number; bar: Bar } | null>(null)

  /**
   * Ticks, not bars.
   *
   * The demo generates individual trades and folds them into the open bar, which is what makes this
   * component the acceptance test it was built to be: most ticks *revise* the newest record rather
   * than appending one, and that is the case RingBuffer.overwrite exists to serve.
   */
  useEffect(() => {
    if (!streaming) return
    setOpenBar(true)
    const timer = setInterval(() => {
      const bars = barsRef.current
      const last = bars[bars.length - 1]!
      const drift = (Math.random() - 0.5) * last.close * 0.004
      aggregateTicks(
        bars,
        [{ time: last.time + INTERVAL_MS * 0.4, price: Math.max(0.01, last.close + drift), size: 50 }],
        INTERVAL_MS,
      )
      setVersion((v) => v + 1)
    }, 90)
    return () => {
      clearInterval(timer)
      setOpenBar(false)
    }
  }, [streaming])

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0, timeEnd: 1, trackCount: 1, rowStart: 0, rowEnd: 1,
    yContinuous: true, width: box.width, height: box.height,
  }))
  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  const onFollowChange = useCallback((next: boolean) => setFollow(next), [])

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>
          GPUCandlestick — {fmtInt(source.bars.length)} bars resident on the GPU
        </span>
        <span {...stylex.props(s.readoutValue)}>
          {hover ? (
            `#${fmtInt(hover.index)}  O ${hover.bar.open.toFixed(2)}  H ${hover.bar.high.toFixed(2)}  L ${hover.bar.low.toFixed(2)}  C ${hover.bar.close.toFixed(2)}`
          ) : (
            <Dim>hover a bar</Dim>
          )}
        </span>
      </div>

      <div {...stylex.props(s.controls)}>
        <Btn onClick={() => setStreaming((v) => !v)}>{streaming ? 'Stop ticks' : 'Start ticks'}</Btn>
        <Btn onClick={() => setFollow((v) => !v)}>{follow ? 'Following' : 'Not following'}</Btn>
        <Field label={`Bar width ${pitch.toFixed(1)}px`}>
          <input
            type="range" min={1.5} max={40} step={0.5} value={pitch}
            aria-label="Bar width"
            onChange={(e) => setPitch(Number(e.target.value))}
          />
        </Field>
      </div>

      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUCandlestick
            source={source}
            viewport={viewport}
            pitchPx={pitch}
            onPitchChange={setPitch}
            follow={follow}
            onFollowChange={onFollowChange}
            onHoverBar={setHover}
            aria-label="Price chart"
          />
        )}
      </div>

      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">zoom about the cursor</Hint>
        <Hint keys="shift + wheel">pan</Hint>
        <Hint keys="hover">read OHLC</Hint>
      </div>

      <p {...stylex.props(s.footnote)}>
        This one exists to test a primitive rather than to add a chart. <code>RingBuffer</code> shipped
        with the log viewer and had exactly one consumer, which means it was shaped entirely by log
        lines — and a primitive with one caller may just be that caller’s internals in another file.
        Building a second, independent consumer found the gap immediately: a log line is history the
        moment it is written, but a candlestick’s newest bar is <em>open</em>, and every tick revises
        its high, low, close and volume. That is <code>RingBuffer.overwrite</code>, which now exists.
        Start the ticks and almost every one of them rewrites a single 24-byte record in place. The
        strip along the bottom is the whole-history envelope — min, max and volume across all{' '}
        {fmtInt(source.bars.length)} bars, reduced on the GPU, not the few hundred on screen.
      </p>
    </div>
  )
}

/** Stable identity: a fresh object each render trips GPUProvider's "options changed" warning. */
const PROVIDER_OPTIONS = { profiling: true }

export function CandlestickDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <CandlestickStage />
    </GPUProvider>
  )
}
