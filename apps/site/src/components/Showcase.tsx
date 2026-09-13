'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import dynamic from 'next/dynamic'
import { useGpu } from '@gpuc/react'
import { color, font, radius, shadow } from '../tokens.stylex'

/**
 * Four components, one shared runtime — the landing page's central claim, rendered rather than
 * asserted.
 *
 * Two things make this different from a playground page. First, every demo under `demos/` wraps
 * its *own* provider, because one page there shows one component; mounting four of those here
 * would create four devices and demonstrate the opposite of the point. These stages are therefore
 * written against the registry components directly and share the landing page's single provider —
 * `LandingGpu` in `HeroStage.tsx` — so the whole page is one `GPUDevice`. (That makes this
 * component landing-page-only by construction: it assumes a `<GPUProvider>` above it.)
 *
 * Second, the caption is derived, not written, so the figure on screen cannot drift from the truth
 * the way a hard-coded "four components, one device" would. That mattered immediately: the first
 * version read `profiler.lastFrame.componentCount` and rendered "1 component", because that field
 * counts components the scheduler *redrew* on the last tick, not components mounted — settled
 * components are skipped, which is the whole point of the dirty flag. The caption now reports both
 * numbers and says which is which.
 *
 * Each stage lives in its own module under `showcase/`, loaded via `next/dynamic` rather than a
 * top-level import: the registry component it renders (and that component's own WGSL/data-prep
 * code) forms its own webpack chunk regardless, but a static import here still made Next fetch all
 * four chunks as unconditional `<script async>` tags on every visit to "/" — `useLazyMount`'s
 * `{visible && <TimelineStage />}` gate was only ever deferring the *mount*, not the *download*,
 * so a visitor who never scrolled this far still paid ~100KB raw of JS for four demos they never
 * saw. `dynamic(..., { ssr: false })` makes the import itself wait for the same `visible` flag.
 */
const TimelineStage = dynamic(() => import('./showcase/TimelineStage'), { ssr: false })
const ScatterStage = dynamic(() => import('./showcase/ScatterStage'), { ssr: false })
const HeatmapStage = dynamic(() => import('./showcase/HeatmapStage'), { ssr: false })
const GridStage = dynamic(() => import('./showcase/GridStage'), { ssr: false })

export function Showcase() {
  return <ShowcaseBody />
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

function Panel({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: ReactNode
}) {
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
  caption: { fontSize: 14, lineHeight: 1.6, color: color.textDim, margin: 0 },
  captionStrong: { color: color.text, fontWeight: 600 },
})
