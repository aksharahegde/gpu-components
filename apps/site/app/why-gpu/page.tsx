import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import {
  B,
  Body,
  C,
  Card,
  Grid,
  H3,
  LI,
  List,
  Notice,
  PageHead,
  Section,
  Stack,
  tone,
  util,
} from '../../src/ui'
import { SpanBenchmark } from '../../src/components/SpanBenchmark'

export const metadata: Metadata = {
  title: 'Why GPU — gpu-components',
}

const s = stylex.create({
  index: { fontSize: 13 },
  where: { fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' },
})

const GATE: Array<[string, string]> = [
  [
    'Does the workload exceed what one CPU frame can touch?',
    'The ceiling is primitives issued per frame from JS: ~5k DOM nodes, ~50k Canvas2D fillRects at 60fps. Instancing changes the unit from one call per primitive to one call per million.',
  ],
  [
    'Is there per-element work that is data-parallel?',
    'Colour mapping, thresholding, normalisation, projection, LOD bucketing, min/max reduction.',
  ],
  [
    'Does interaction re-derive the whole dataset?',
    'Zoom, pan, brush and filter over an immutable dataset is the ideal case: upload once, re-render from a changed uniform. CPU pipelines re-walk the data every time.',
  ],
  [
    'Can we avoid CPU↔GPU round-trips?',
    'Anything needing a synchronous readback per frame is disqualified. vgpu is explicit that read() is for tests and diagnostics, not a hot path.',
  ],
  [
    'Is the text budget bounded?',
    'Text is the tax. More than ~1k glyph runs per frame means the glyph atlas has to exist first.',
  ],
  [
    'Does it produce reusable runtime primitives?',
    'A component needing a bespoke pipeline nobody else reuses is a demo, not a library investment.',
  ],
]

const GPU_WORK = [
  'Instanced primitive rendering from a storage buffer',
  'Viewport transform — pan/zoom is a uniform write',
  'Colour mapping, normalisation, thresholding',
  'LOD and density binning with atomics',
  'Reductions for auto-ranging and histograms',
  'Selection as a bitset the shader branches on',
  'ID-buffer picking where a CPU index is impractical',
]

const WORKER_WORK = [
  'Parsing — JSON, OTLP, Arrow',
  'Building columnar typed arrays',
  'Sorting by (track, start) — once, never per frame',
  'Building the spatial index for CPU hit-testing',
  'String interning',
  'Transfer via Transferable, zero copy',
]

const CPU_WORK = [
  'All string handling — formatting, search, collation',
  'Track and column layout',
  'Hit-testing via the sorted index — O(log n), exact, immediate',
  'Tooltip contents',
  'The accessibility tree',
]

const UNCOMFORTABLE: Array<[string, string]> = [
  [
    'WebGL2 instancing is also fast',
    'For raw quad throughput, WebGPU’s advantage over a competent WebGL2 instanced renderer may be modest. This is the biggest technical risk in the project, it gets measured in week 1 before any runtime code exists, and the comparison gets published even when it is close. The durable WebGPU advantages are compute in the data path, indirect draws and dispatches, and storage-buffer-driven vertex work — not fill rate.',
  ],
  [
    'Canvas2D is better than people assume',
    'At viewport scale, Canvas2D is sufficient — which is precisely why a canvas data grid already scrolls millions of rows at 60fps today. Anyone selling you a GPU grid on scroll performance is selling you something you already have.',
  ],
  [
    'Below the crossover, the GPU path is slower',
    'Upload cost and pipeline overhead dominate at small N. The hypothesis is a crossover somewhere around 20k–50k primitives. The measured number goes in each component’s docs, in a section titled “When NOT to use this”, along with a recommendation for what to use instead.',
  ],
]

function WorkColumn({
  where,
  toneStyle,
  subtitle,
  items,
}: {
  where: string
  toneStyle: typeof tone.accent
  subtitle: string
  items: string[]
}) {
  return (
    <Card>
      <Stack gap={12}>
        <Stack gap={4}>
          <span {...stylex.props(util.monoSm, s.where, toneStyle)}>{where}</span>
          <H3 sm>{subtitle}</H3>
        </Stack>
        <List sm>
          {items.map((i) => (
            <LI key={i}>{i}</LI>
          ))}
        </List>
      </Stack>
    </Card>
  )
}

function WhyGpu() {
  return (
    <>
      <PageHead
        eyebrow="Why GPU"
        title="Do not use the GPU merely because it is possible."
        lead="Every component in this library has to clear a six-question gate. Components that fail it are rejected — including ones that would look impressive in a screenshot."
      />

      <Section eyebrow="The gate" title="Six questions, all of which must pass.">
        <Grid cols={2}>
          {GATE.map(([q, a], i) => (
            <Card key={q}>
              <Stack gap={10}>
                <span {...stylex.props(util.monoSm, s.index, tone.accent)}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <H3 sm>{q}</H3>
                <Body sm>{a}</Body>
              </Stack>
            </Card>
          ))}
        </Grid>

        <Notice variant="amber">
          <B>Rejected outright:</B> particle backgrounds, shader wallpapers, decorative
          post-processing, generic 3D scene viewers. They fail question 1 (no data-scale problem)
          or question 6 (no primitive another application component needs). vgpu already ships{' '}
          <C>vgpu/scene</C> for 3D meshes — duplicating it is an explicit non-goal.
        </Notice>
      </Section>

      <Section
        eyebrow="Measured in your browser"
        title="The ceiling, live."
        lead="Every span in the dataset is on screen, so every span is drawn every frame. This is the case a GPU instanced draw collapses into a single call."
      >
        <SpanBenchmark />
      </Section>

      <Section eyebrow="Division of work" title="What runs where, and what must not move.">
        <Grid cols={3}>
          <WorkColumn
            where="GPU"
            toneStyle={tone.accent}
            subtitle="Data-parallel, per-frame"
            items={GPU_WORK}
          />
          <WorkColumn
            where="Worker"
            toneStyle={tone.mint}
            subtitle="Once per dataset"
            items={WORKER_WORK}
          />
          <WorkColumn
            where="Main thread"
            toneStyle={tone.amber}
            subtitle="Stays on CPU, deliberately"
            items={CPU_WORK}
          />
        </Grid>

        <Notice variant="accent">
          <B>Hit-testing on the CPU is a feature, not a fallback.</B> Because the data is sorted
          with a per-track index, a hover test is a binary search: exact and available this frame.
          GPU picking is always one frame late, so it is reserved for layers where a cheap CPU index
          genuinely is not possible — dense scatter, graph nodes.
        </Notice>
      </Section>

      <Section
        eyebrow="Honesty"
        title="Where this argument gets uncomfortable."
        lead="Three things that will be true in the published benchmarks, stated here before anyone finds them."
      >
        <Stack gap={16}>
          {UNCOMFORTABLE.map(([t, b]) => (
            <Card key={t}>
              <Stack gap={8}>
                <H3 sm>{t}</H3>
                <Body sx={util.wide}>{b}</Body>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Section>
    </>
  )
}

export default WhyGpu
