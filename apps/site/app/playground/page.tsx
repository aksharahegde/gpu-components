import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import { Body, PageHead, Section } from '../../src/ui'
import { Link } from '../../src/link'
import { color, font, radius } from '../../src/tokens.stylex'

export const metadata: Metadata = {
  title: 'Playground — gpu-components',
  description: 'Every component, running live on your GPU, one page each.',
}

const COMPONENTS = [
  {
    slug: 'timeline',
    name: 'GPUTimeline',
    blurb: 'Spans, flame graphs, Gantt and waterfalls. Up to 500,000 spans, pan, zoom, brush-select.',
    note: 'The first component, and the one the runtime was designed against.',
  },
  {
    slug: 'heatmap',
    name: 'GPUHeatmap',
    blurb: 'A dense matrix with a GPU colormap and GPU auto-ranging, zoomable on both axes.',
    note: 'The architecture test: could core host a component it was not designed around?',
  },
  {
    slug: 'grid',
    name: 'GPUDataGrid',
    blurb: 'Read-only grid with per-cell conditional formatting evaluated in the fragment shader.',
    note: 'The flagship, built last, on primitives the others had already paid for.',
  },
  {
    slug: 'scatter',
    name: 'GPUScatter',
    blurb: '250,000 points, one draw call. Zoom, filter and brush are all uniform writes.',
    note: 'The clearest demo here — and it disproved a claim in the project’s own plan.',
  },
  {
    slug: 'graph',
    name: 'GPUGraph',
    blurb: 'Force-directed layout running entirely on the GPU, settling in front of you.',
    note: 'The only one that animates, and the only one that cannot hit-test on the CPU.',
  },
  {
    slug: 'imagediff',
    name: 'GPUImageDiff',
    blurb: 'Split, onion-skin, difference and heat comparison of two images, with a GPU pixel count.',
    note: 'The only one that uses real textures — and it filled a hole in the plan’s own contract.',
  },
  {
    slug: 'logviewer',
    name: 'GPULogViewer',
    blurb: 'Half a million lines in a GPU ring, streaming appends, and match density over all of them.',
    note: 'The first dataset here with a tail — and the component that retired the glyph atlas.',
  },
  {
    slug: 'candlestick',
    name: 'GPUCandlestick',
    blurb: '200,000 OHLC bars, revised tick by tick, with a whole-history envelope along the bottom.',
    note: 'Built to test RingBuffer rather than to add a chart. It found the gap it went looking for.',
  },
] as const

export default function PlaygroundIndex() {
  return (
    <>
      <PageHead
        eyebrow="Playground"
        title="Grab the components"
        lead="Everything else on this site argues that the runtime works. These pages let you check. Each one is the real component, running in your browser, on your GPU."
      />

      <Section>
        <div {...stylex.props(s.grid)}>
          {COMPONENTS.map((component) => (
            <Link key={component.slug} to={`/playground/${component.slug}`} sx={s.card}>
              <span {...stylex.props(s.name)}>{component.name}</span>
              <span {...stylex.props(s.blurb)}>{component.blurb}</span>
              <span {...stylex.props(s.note)}>{component.note}</span>
              <span {...stylex.props(s.open)}>Open →</span>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="One page each, and why">
        <Body>
          Each page mounts its own <code>&lt;GPUProvider&gt;</code>, so it holds exactly one
          <code> GPUDevice</code> for exactly one component. That is the honest arrangement for a
          demo you are here to look at closely — and it is also why the inspector on each page reports
          a single device and a single surface.
        </Body>
        <Body>
          The claim that one device serves <em>many</em> components on a page is measured rather than
          demonstrated by decoration: the benchmark harness drives up to 24 components through one
          runtime and compares the GPU time against the same work split across independent devices.
          The shared runtime costs meaningfully less from eight components upward. That measurement,
          including the round where the methodology turned out to be wrong, is written up in the
          repository’s decision record.
        </Body>
      </Section>
    </>
  )
}

const s = stylex.create({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 18,
    textDecoration: 'none',
    backgroundColor: { default: color.surface, ':hover': color.surface2 },
    border: `1px solid ${color.border}`,
    borderColor: { default: color.border, ':hover': color.borderHover },
    borderRadius: radius.md,
  },
  name: { fontFamily: font.mono, fontSize: 14, color: color.text },
  blurb: { fontSize: 13, lineHeight: 1.6, color: color.textDim },
  note: { fontSize: 12, lineHeight: 1.6, color: color.textFaint },
  open: { marginTop: 'auto', paddingTop: 6, fontFamily: font.mono, fontSize: 12, color: color.accent },
})
