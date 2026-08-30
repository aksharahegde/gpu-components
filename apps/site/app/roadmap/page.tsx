import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import { color, font } from '../../src/tokens.stylex'
import {
  B,
  Body,
  Card,
  Chip,
  Eyebrow,
  Grid,
  H3,
  LI,
  List,
  PageHead,
  Row,
  Section,
  Small,
  Stack,
  Status,
  tone,
  util,
} from '../../src/ui'

export const metadata: Metadata = {
  title: 'Roadmap — gpu-components',
}

/** Inlined rather than shared — see `src/ui.tsx`'s equivalent comment. */
const PHASE_BP = '@media (max-width: 700px)'

const s = stylex.create({
  phase: {
    display: 'grid',
    gridTemplateColumns: { default: '132px minmax(0, 1fr)', [PHASE_BP]: 'minmax(0, 1fr)' },
    gap: { default: 24, [PHASE_BP]: 12 },
    paddingBlock: 22,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  phaseLast: { borderBottomWidth: 0 },
  id: { fontFamily: font.mono, fontSize: 13, color: color.textFaint },
  acceptLabel: { fontFamily: font.mono, fontSize: 11.5, letterSpacing: '0.06em' },
})

type Phase = {
  id: string
  dur: string
  title: string
  state: 'planned' | 'progress'
  goal: string
  items: string[]
  accept: string
}

const PHASES: Phase[] = [
  {
    id: 'Phase 0',
    dur: '1 week',
    title: 'Research & validation',
    state: 'progress',
    goal: 'Prove the two load-bearing assumptions before writing the runtime. No runtime code this phase.',
    items: [
      'Benchmark harness + deterministic seeded dataset generators (1k → 10M)',
      'Measured baselines: DOM, Canvas2D, and a WebGL2 instanced renderer',
      'Spike: one device / many canvases / one submit, vs N independent devices',
      'Spike: GPU time precision — WGSL has no f64, and traces span ns to hours',
    ],
    accept:
      'Harness runs headless in CI and in three browsers; baselines committed with methodology. The numbers, not the hopes, set the phase 4 targets.',
  },
  {
    id: 'Phase 1',
    dur: '2 weeks',
    title: 'GPU runtime',
    state: 'planned',
    goal: '@gpu-components/core + @gpu-components/react, minimum viable.',
    items: [
      'GpuRuntime, Capabilities, device-loss detection and replay',
      'FrameScheduler + RenderPlan, dirty tracking, compute-before-render',
      'ResourceRegistry, TargetPool, InstanceBuffer — and the leak test',
      'GPUProvider + three hooks; shared WGSL module package + typegen',
    ],
    accept:
      'Two components on one page → one device, one submit. 100 mount/unmount cycles → zero leaked objects. core builds with React uninstalled.',
  },
  {
    id: 'Phase 2',
    dur: '3 weeks',
    title: 'First component — GPUTimeline',
    state: 'planned',
    goal: 'A real, useful timeline.',
    items: [
      'Worker ingest → columnar typed arrays → sorted index → Transferable handoff',
      'Instanced span rendering, viewport model, LOD binning, indirect draw',
      'DOM label overlay — which is also the accessibility layer',
      'Registry entry + CLI add',
    ],
    accept:
      '1M spans render correctly; labels correct at every zoom; keyboard navigation complete; axe-core clean; `add` works in a fresh Vite and a fresh Next.js app.',
  },
  {
    id: 'Phase 3',
    dur: '1.5 weeks',
    title: 'Interaction',
    state: 'planned',
    goal: 'Interaction primitives, in core, reusable by every later component.',
    items: [
      'Pointer / wheel / keyboard / touch state machines, DOM-event-source agnostic',
      'Inertial pan and zoom, reduced-motion aware',
      'CPU hit-testing via the per-track index; async GPU ID-buffer picking as opt-in',
      'Brush and lasso selection via a GPU bitset mask',
    ],
    accept:
      'Hover ≤16ms at 5M spans. Brush-select 100k spans without a frame drop. Gestures identical across all three engines.',
  },
  {
    id: 'Phase 4',
    dur: '2 weeks',
    title: 'Performance & tooling',
    state: 'planned',
    goal: 'Hit the targets, or publicly revise them.',
    items: [
      'GPU inspector with the anti-pattern warnings pane',
      'Adaptive quality — degrades with a callback, never silently',
      'Glyph atlas (v2 text) if the label budget demands it',
      'Nightly perf regression gate; the full published benchmark report',
    ],
    accept:
      '5M spans p95 ≤ 16.6ms on mid discrete. Regression gate live. Inspector detects all five documented anti-patterns.',
  },
  {
    id: 'Phase 5',
    dur: '4 weeks',
    title: 'Component expansion',
    state: 'planned',
    goal: 'Prove runtime reuse. This phase validates or falsifies the whole architecture.',
    items: [
      'GPUHeatmap — raster, colormap, GPU binning',
      'GPUDataGrid — glyph atlas, TanStack Table as a renderer, GPU sort/filter/aggregate',
    ],
    accept:
      'GPUHeatmap ships requiring ZERO changes to core. If it does not, the abstraction was wrong and we fix it before the grid, not after.',
  },
  {
    id: 'Phase 6',
    dur: '1.5 weeks',
    title: 'CLI & distribution',
    state: 'planned',
    goal: 'Installation is boring and reliable.',
    items: [
      'add / diff / doctor / list; shadcn-compatible registry.json',
      'Bundler auto-config for Vite, webpack and Turbopack',
      'Registry integrity verification; templates for Vite, Next.js and Remix',
    ],
    accept:
      'npm install → rendering component in under five minutes, scripted e2e on all three bundlers.',
  },
  {
    id: 'Phase 7',
    dur: 'ongoing',
    title: 'Ecosystem',
    state: 'planned',
    goal: 'Docs, playground, contribution process, more components.',
    items: [
      'Component RFC process; community registry with mandatory review',
      'GPUScatter, GPUGraph, flame-graph variant',
    ],
    accept: 'At least one contributed component RFC, and three external projects in production.',
  },
]

const RISKS: Array<[string, string, string]> = [
  [
    'WebGPU’s edge over WebGL2 is modest for quad throughput',
    'High likelihood, high impact',
    'Measure in phase 0 before building. Position on compute in the data path, indirect draws and storage-buffer-driven vertex work — not fill rate. Publish the comparison even when it is close.',
  ],
  [
    'The runtime abstraction is wrong and component #2 needs core changes',
    'Medium likelihood, high impact',
    'Phase 5 makes this a falsifiable acceptance criterion, discovered around week 14 rather than at v1.0.',
  ],
  [
    'Scope creep into a general 2D GPU renderer',
    'High likelihood, high impact',
    'The four-primitive rule is a hard architectural boundary. A fifth primitive requires an RFC.',
  ],
]

function Roadmap() {
  return (
    <>
      <PageHead
        eyebrow="Roadmap"
        title="Week one is measurement, not code."
        lead="If the WebGPU advantage over WebGL2 is smaller than assumed, that should change the plan before it changes the marketing. So the first deliverable is a benchmark harness and honest baselines."
      />

      <Section flush>
        <div>
          {PHASES.map((p, i) => (
            <div key={p.id} {...stylex.props(s.phase, i === PHASES.length - 1 && s.phaseLast)}>
              <Stack gap={8}>
                <span {...stylex.props(s.id)}>{p.id}</span>
                <Row>
                  <Status state={p.state}>{p.dur}</Status>
                </Row>
              </Stack>
              <Stack gap={12}>
                <H3>{p.title}</H3>
                <Body>{p.goal}</Body>
                <List sm>
                  {p.items.map((it) => (
                    <LI key={it}>{it}</LI>
                  ))}
                </List>
                <Small sx={util.wide}>
                  <span {...stylex.props(s.acceptLabel, tone.mint)}>ACCEPTANCE</span> {p.accept}
                </Small>
              </Stack>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Success" title="How we will know it worked.">
        <Grid cols={3}>
          <Card>
            <Stack gap={12}>
              <Eyebrow sx={tone.accent}>Primary · architectural</Eyebrow>
              <Body>
                <B>GPUHeatmap ships in phase 5 requiring zero changes to core.</B> That is the
                falsifiable test of whether we built a runtime or just a component with extra steps.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={12}>
              <Eyebrow sx={tone.accent}>Secondary · performance</Eyebrow>
              <Body>
                <B>5M spans at p95 ≤ 16.6ms</B> sustained pan and zoom on a mid-range discrete GPU,
                with the Canvas2D crossover measured and published in the docs.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={12}>
              <Eyebrow sx={tone.accent}>Tertiary · adoption</Eyebrow>
              <Body>
                <B>Three external projects in production</B> within six months of v1, and at least
                one contributed component RFC.
              </Body>
            </Stack>
          </Card>
        </Grid>
      </Section>

      <Section eyebrow="Risk register" title="The three that would actually hurt.">
        <Stack gap={16}>
          {RISKS.map(([t, likelihood, mitigation]) => (
            <Card key={t}>
              <Stack gap={8}>
                <Row gap={12} sx={util.center}>
                  <H3 sm>{t}</H3>
                  <Chip>{likelihood}</Chip>
                </Row>
                <Body sm sx={util.wide}>
                  {mitigation}
                </Body>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Section>
    </>
  )
}

export default Roadmap
