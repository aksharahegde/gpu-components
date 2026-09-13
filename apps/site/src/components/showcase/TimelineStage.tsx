'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ViewportState } from '@gpu-components/core'
import { GPUTimeline, ingestSpans, type RawSpan } from '../../../../../registry/timeline'
import { mulberry32 } from '../demos/chrome'
import { Stage } from './Stage'

const SPAN_NAMES = ['fetchUser', 'db.query', 'render', 'auth.verify', 'cache.get', 'net.write']
const DOMAIN_MS = 60_000

export default function TimelineStage() {
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

  return <Stage>{(box) => <TimelineInner spans={spans} box={box} />}</Stage>
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
