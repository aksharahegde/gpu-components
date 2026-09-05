import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import { Body, C, PageHead, Row, Section, Stack, Status } from '../../src/ui'
import { Link } from '../../src/link'
import { color, font, radius } from '../../src/tokens.stylex'

export const metadata: Metadata = {
    title: 'Playground — gpu-components',
  description:
    'Seventeen GPU components, one page each — live demos running in your browser on your GPU.',
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
  {
    slug: 'densitymap',
    name: 'GPUDensityMap',
    blurb: '200,000 lon/lat points hexbinned on the GPU over Web Mercator — graticule chrome, no tiles.',
    note: 'The geospatial density candidate: projection at ingest, atomic hexbin, colormap fill.',
  },
  {
    slug: 'histogram',
    name: 'GPUHistogram',
    blurb: '250,000 values, Freedman–Diaconis bins at ingest, GPU atomic binning into instanced bars.',
    note: 'Adaptive layout on the CPU once; the GPU owns the N-wide bin pass and the draw.',
  },
  {
    slug: 'depgraph',
    name: 'GPUDepGraph',
    blurb: 'Sugiyama layered package DAG with orthogonal edges — layout once on the CPU, GPU draw only.',
    note: 'Cycles become styled back-edges; no force layout, no continuous animation.',
  },
  {
    slug: 'networktopology',
    name: 'GPUNetworkTopology',
    blurb: 'Force-laid service mesh with status, link health, and traffic pulse.',
    note: 'Playground-only until the shared force-layout animation defect is fixed.',
  },
  {
    slug: 'annotationcanvas',
    name: 'GPUAnnotationCanvas',
    blurb: 'A Float32 field with a GPU colormap and a host-owned rect/ellipse/point/ruler/polygon overlay.',
    note: 'Hybrid interaction: every draw tool emits an event, and the page decides whether to keep it.',
  },
  {
    slug: 'spreadsheet',
    name: 'GPUSpreadsheet',
    blurb: 'Editable cells, a dependency-graph formula engine, selection, clipboard, and pivot tables.',
    note: 'The lowest-feasibility candidate in the plan’s own scoring — formulas stay on the CPU.',
  },
  {
    slug: 'nodeeditor',
    name: 'GPUNodeEditor',
    blurb: 'Drag nodes, drag-to-connect ports, multi-select and delete — all CPU-owned, GPU-drawn.',
    note: 'The weakest GPU-necessity score in the plan’s own matrix — earns its place at scale, not here.',
  },
  {
    slug: 'whiteboard',
    name: 'GPUWhiteboard',
    blurb: 'A procedural dot-grid canvas with instanced shapes and ink, forked from GPUAnnotationCanvas.',
    note: 'Phase 1 only — pan, zoom, hover. Draw tools and multi-select are still to come.',
  },
  {
    slug: 'pdfviewer',
    name: 'GPUPdfViewer',
    blurb: 'A small resident-texture pool composites host-rasterized pages, virtualized and zoomable.',
    note: 'The worst feasibility score in the plan’s own matrix — it wraps a renderer it deliberately isn’t.',
  },
] as const

export default function PlaygroundIndex() {
  return (
    <>
      <PageHead
        eyebrow="Playground"
        title="Grab the components"
        lead="Everything else on this site argues that the runtime works. These pages let you check — seventeen components, one page each, each running live in your browser on your GPU."
      />

      <Section flush>
        <Stack gap={20}>
          <Row>
            <Status state="live">17 live demos · one device per page</Status>
          </Row>
          <div {...stylex.props(s.grid)}>
            {COMPONENTS.map((component) => (
              <Link
                key={component.slug}
                to={`/playground/${component.slug}`}
                sx={s.card}
                aria-label={`Open ${component.name} demo`}
              >
                <span {...stylex.props(s.name)}>{component.name}</span>
                <span {...stylex.props(s.blurb)}>{component.blurb}</span>
                <span {...stylex.props(s.note)}>{component.note}</span>
                <span {...stylex.props(s.open)}>Open demo →</span>
              </Link>
            ))}
          </div>
        </Stack>
      </Section>

      <Section title="One page each, and why">
        <Stack gap={16}>
          <Body>
            Each page mounts its own <C>GPUProvider</C>, so it holds exactly one <C>GPUDevice</C> for
            exactly one component. That is the honest arrangement for a demo you are here to look at
            closely — and it is also why the inspector on each page reports a single device and a
            single surface.
          </Body>
          <Body>
            The claim that one device serves <em>many</em> components on a page is measured rather than
            demonstrated by decoration: the benchmark harness drives up to 24 components through one
            runtime and compares the GPU time against the same work split across independent devices.
            The shared runtime costs meaningfully less from eight components upward. That measurement,
            including the round where the methodology turned out to be wrong, is written up in the
            repository’s decision record.
          </Body>
        </Stack>
      </Section>
    </>
  )
}

const s = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(272px, 1fr))',
    gap: 16,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 168,
    padding: 22,
    textDecoration: 'none',
    backgroundColor: { default: color.surface, ':hover': color.surface2 },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.borderHover },
    borderRadius: radius.lg,
    transitionProperty: 'background-color, border-color',
    transitionDuration: '140ms',
    transitionTimingFunction: 'ease',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: { default: 0, ':focus-visible': 2 },
  },
  name: {
    fontFamily: font.mono,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: color.text,
  },
  blurb: { fontSize: 14, lineHeight: 1.6, color: color.textDim },
  note: { fontSize: 12.5, lineHeight: 1.6, color: color.textFaint },
  open: {
    marginTop: 'auto',
    paddingTop: 8,
    fontFamily: font.mono,
    fontSize: 12,
    color: color.accent,
  },
})
