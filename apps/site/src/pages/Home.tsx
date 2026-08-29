import * as stylex from '@stylexjs/stylex'
import { bp } from '../breakpoints.stylex'
import { color } from '../tokens.stylex'
import {
  B,
  Body,
  C,
  Card,
  Code,
  Eyebrow,
  Grid,
  H1,
  H2,
  H3,
  LI,
  Lead,
  List,
  Notice,
  Row,
  Section,
  Small,
  Stack,
  Status,
  Table,
  TableScroll,
  Td,
  Th,
  Wrap,
  c,
  fn,
  k,
  str,
  tone,
  util,
} from '../ui'
import { A } from '../components/Chrome'
import { LinkBtn } from '../components/LinkBtn'
import { Layers } from '../components/Layers'
import { SpanBenchmark } from '../components/SpanBenchmark'

const s = stylex.create({
  hero: {
    position: 'relative',
    paddingBlock: '92px 76px',
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  // A real element rather than ::before — StyleX prefers elements, and this
  // keeps the decorative layer out of the accessibility tree explicitly.
  glow: {
    position: 'absolute',
    insetInline: 0,
    insetBlockStart: '-40%',
    height: 620,
    pointerEvents: 'none',
    backgroundImage: `radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in srgb, ${color.accent} 15%, transparent), transparent 70%)`,
  },
  heroInner: { position: 'relative' },
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
      [bp.hero]: 'minmax(0, 1fr)',
    },
    gap: { default: 48, [bp.hero]: 36 },
    alignItems: 'center',
  },
  cta: { alignItems: 'flex-start' },
})

const VGPU_SPLIT: Array<[string, string, string]> = [
  ['Device, queue, adapter', 'init() / initFromDevice()', 'Provider-scoped, ref-counted runtime'],
  ['Canvases', 'surface(gpu, canvas) — many per device', 'Registry, DPR policy, resize → uniform'],
  ['Pipelines & shaders', 'Cache keyed by shader × target signature', 'Pre-warm orchestration at mount'],
  ['Draw / compute', 'draw() · effect() · compute() · indirect', 'Four primitives, layer abstractions'],
  ['Frames', 'frame() — one encoder, one submit', 'The multi-component scheduler'],
  ['WGSL toolchain', 'Imports, DCE, reflection, loaders, check', 'Shared modules + TS typegen'],
  ['Testing', 'vgpu/mock · vgpu/node · pixelDiff', 'Harness, leak assertions, snapshots'],
  ['Text', '— none', 'DOM labels v1, glyph atlas v2'],
  ['Picking / hit test', '— none', 'CPU index by default, async GPU opt-in'],
  ['Device loss', '— not recovered', 'Detect, re-init, replay from CPU mirror'],
  ['Accessibility', '— out of scope', 'Semantic overlay, same layer as labels'],
]

const HOUSE_RULES: Array<[string, string]> = [
  [
    'Every component documents when NOT to use it',
    'With a measured crossover number. Below ~30k spans a Canvas2D timeline is faster end to end, and the docs will say so and link to the measurement.',
  ],
  [
    'The WebGL2 comparison gets published even when it is close',
    'The biggest technical risk is that WebGPU’s edge over WebGL2 is modest for raw quad throughput. That gets measured in week 1, before any runtime code is written.',
  ],
  [
    'No invented telemetry',
    'WebGPU exposes no GPU memory API. The inspector reports “allocated by this library” and says “not available in WebGPU” rather than estimating.',
  ],
  [
    'Fallback degrades loudly',
    'Above the Canvas2D cap the data is downsampled and a callback fires. It is never silently truncated.',
  ],
  [
    'Keyboard and screen reader from day one',
    'Navigation moves the viewport, not just the focus ring, so keyboard users reach the whole dataset — not only what happens to be on screen.',
  ],
  [
    'No scene graph, no second renderer',
    'Four rendering primitives, and a fifth requires an RFC. That boundary is what stops this becoming an accidental rewrite of PixiJS.',
  ],
]

export function Home() {
  return (
    <>
      {/* ── hero ───────────────────────────────────────────────────────── */}
      <section {...stylex.props(s.hero)}>
        <div {...stylex.props(s.glow)} aria-hidden="true" />
        <Wrap sx={s.heroInner}>
          <div {...stylex.props(s.heroGrid)}>
            <Stack gap={24}>
              <Row>
                <Status state="planned">Pre-implementation · design published for review</Status>
              </Row>
              <H1>
                GPU components that
                <br />
                share one device.
              </H1>
              <Lead>
                A framework-independent WebGPU runtime for application components, built on{' '}
                <A href="https://vgpu.sh">vgpu</A>. One device, one frame, one submit — across every
                component on the page.
              </Lead>
              <Row>
                <LinkBtn to="/architecture" primary>
                  Read the architecture
                </LinkBtn>
                <LinkBtn to="/why-gpu">Why GPU?</LinkBtn>
              </Row>
              <Small sx={util.narrow}>
                No code has shipped yet. Every number on this site is either measured in your
                browser as you read it, or explicitly labelled as an unvalidated target.
              </Small>
            </Stack>

            <Layers />
          </div>
        </Wrap>
      </section>

      {/* ── the gap ────────────────────────────────────────────────────── */}
      <Section
        eyebrow="The gap"
        title="The hole is runtime-shaped, not component-shaped."
        lead={
          <>
            WebGPU reached Baseline in January 2026, and the first wave of WebGPU component
            libraries has already shipped. They are charts. What none of them have is the thing
            that makes a component <em>library</em> rather than a component.
          </>
        }
      >
        <Grid cols={3}>
          <Card>
            <Stack gap={12}>
              <H3>Two libraries, two devices</H3>
              <Body>
                Put a WebGPU chart library and a WebGPU map on one page today and you get two
                adapter requests, two devices, two pipeline caches, and two rAF loops competing for
                the same 16.6ms. Nothing composes, and nothing can sample anything else's output.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={12}>
              <H3>Text, picking, device loss</H3>
              <Body>
                WebGPU has no text rendering, and neither does vgpu — a full scan of its docs
                returns zero hits for <C>font</C>, <C>glyph</C>, or <C>msdf</C>. It also does not
                recover a lost device. Those three are ours to own, deliberately.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={12}>
              <H3>Accessibility is architectural</H3>
              <Body>
                A canvas is an opaque pixel buffer to a screen reader. Retrofitting semantics onto a
                GPU renderer does not work, because the semantic model has to be the same model the
                renderer draws from. So we build it in phase 2, not v2.
              </Body>
            </Stack>
          </Card>
        </Grid>
      </Section>

      {/* ── live benchmark ─────────────────────────────────────────────── */}
      <Section
        id="ceiling"
        eyebrow="Measured in your browser, right now"
        title="Where DOM and Canvas2D actually break."
        lead={
          <>
            This is the zoomed-out case: every span in the dataset is on screen, so every span must
            be drawn every frame. Drag the slider. Switch renderers. The numbers below are produced
            by your machine, not by us.
          </>
        }
      >
        <SpanBenchmark />

        <Grid cols={2}>
          <Notice variant="amber">
            <B>Read this before you read the numbers.</B> The Canvas2D path here is the{' '}
            <em>optimised</em> one — spans are pre-grouped by colour so it pays minimal state
            changes. We are not stacking the comparison. DOM is capped at 20,000 nodes because
            beyond that it stops being a benchmark and starts being a hang.
          </Notice>
          <Notice variant="accent">
            <B>The WebGPU button is disabled on purpose.</B> The runtime is not implemented. The
            plan targets 5M spans at p95 ≤ 16.6ms on a mid-range discrete GPU — a <em>target</em>,
            not a result. It gets published here only once the benchmark harness produces it,
            alongside a WebGL2 baseline that may well be close.
          </Notice>
        </Grid>
      </Section>

      {/* ── what we build ──────────────────────────────────────────────── */}
      <Section
        eyebrow="The runtime"
        title="One device. One frame. One submit."
        lead="A page with six GPU surfaces on it should cost one command buffer per tick, not six. That is the whole product, and it is the part nobody else is building."
      >
        <Grid cols={2} gap={24}>
          <Code file="app.tsx">
            {k('import')} {'{ GPUProvider }'} {k('from')} {str("'@gpu-components/react'")}
            {'\n'}
            {k('import')} {'{ GPUTimeline }'} {k('from')} {str("'@/components/gpu/timeline'")}
            {'\n\n'}
            {c('// One init() → one Gpu → one GPUDevice, shared by every child.')}
            {'\n'}
            {'<'}
            {fn('GPUProvider')}
            {'>'}
            {'\n  <'}
            {fn('GPUTimeline')} spans={'{spans}'} tracks={'{tracks}'} {'/>'}
            {'\n  <'}
            {fn('GPUHeatmap')} data={'{matrix}'} {'/>'}
            {'\n'}
            {'</'}
            {fn('GPUProvider')}
            {'>'}
          </Code>

          <List>
            <LI>
              <B>One command buffer per tick.</B> A frame scheduler collects every mounted
              component's passes into a single <C>frame()</C>, with all compute ordered before all
              render — across components, not just within one.
            </LI>
            <LI>
              <B>Shared everything.</B> Pipeline cache, samplers, colormap textures, glyph atlas,
              the transient uniform ring, and the global uniform block.
            </LI>
            <LI>
              <B>Deterministic teardown.</B> Mount and unmount a hundred times, in StrictMode, and
              leak zero GPU objects. The leak test lands with the resource layer, not after it.
            </LI>
            <LI>
              <B>Clean dirty tracking.</B> A component that did not change contributes no passes. A
              static page costs no GPU work.
            </LI>
          </List>
        </Grid>
      </Section>

      {/* ── division of labour ─────────────────────────────────────────── */}
      <Section
        eyebrow="Division of labour"
        title="What vgpu already does, and what is ours."
        lead="Four of the nine subsystems a runtime like this usually needs are already vgpu's. Rebuilding them would be duplication with a version number on it."
      >
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Concern</Th>
                <Th>vgpu</Th>
                <Th>gpu-components</Th>
              </tr>
            </thead>
            <tbody>
              {VGPU_SPLIT.map(([a, b, d], i) => {
                const last = i === VGPU_SPLIT.length - 1
                return (
                  <tr key={a}>
                    <Td last={last}>
                      <B>{a}</B>
                    </Td>
                    <Td last={last} mono>
                      {b}
                    </Td>
                    <Td last={last} mono>
                      {d}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </TableScroll>
      </Section>

      {/* ── first component ────────────────────────────────────────────── */}
      <Section
        eyebrow="First component"
        title="GPUTimeline — and why it isn't a data grid."
        lead="The obvious opener is a GPU data grid. We are not building that first, and the reasoning is the most load-bearing decision in the plan."
      >
        <Grid cols={2} gap={24}>
          <Card lg>
            <Stack gap={16}>
              <Row>
                <Status state="progress">Phase 2 · the MVP component</Status>
              </Row>
              <H3>GPUTimeline</H3>
              <Body>
                Traces, spans, flame graphs, Gantt charts, network waterfalls — one primitive.
                Target: 5M spans, sustained 60fps pan and zoom, sub-16ms hover.
              </Body>
              <List variant="check">
                <LI variant="check">
                  GPU necessity is unarguable — a 100× gap you can see in a toggle
                </LI>
                <LI variant="check">
                  Labels are bounded by screen width (~200–400), so v1 needs no GPU text engine
                </LI>
                <LI variant="check">
                  The DOM label layer <em>is</em> the accessibility layer
                </LI>
                <LI variant="check">Produces every primitive the data grid will later need</LI>
              </List>
            </Stack>
          </Card>

          <Card lg>
            <Stack gap={16}>
              <Row>
                <Status state="planned">Phase 5 · the flagship</Status>
              </Row>
              <H3>Why GPUDataGrid waits</H3>
              <Body>
                It is the right flagship and the wrong opener. Three reasons, in order of severity:
              </Body>
              <List variant="cross">
                <LI variant="cross">
                  <B>Weakest GPU case.</B> A grid draws ~2,400 visible cells. Its real cost is
                  glyph raster — which is exactly why Canvas2D grids already scroll millions of
                  rows today.
                </LI>
                <LI variant="cross">
                  <B>Hardest unsolved problem first.</B> A grid is ~100% text, and neither WebGPU
                  nor vgpu provides any.
                </LI>
                <LI variant="cross">
                  <B>Largest correctness surface.</B> Editing, copy/paste, column semantics, RTL,
                  IME — grid features, not GPU features.
                </LI>
              </List>
              <div>
                <LinkBtn to="/components">See the full candidate matrix →</LinkBtn>
              </div>
            </Stack>
          </Card>
        </Grid>
      </Section>

      {/* ── distribution ───────────────────────────────────────────────── */}
      <Section
        eyebrow="Distribution"
        title="Versioned runtime. Copied components."
        lead="The runtime is infrastructure nobody wants to fork and everybody wants patched. The component is policy — colours, LOD thresholds, interaction feel, shaders — which is exactly what a props API can never anticipate."
      >
        <Grid cols={2} gap={24}>
          <Code file="terminal">
            {c('# versioned, semver’d, upgradeable')}
            {'\n'}
            {fn('npm')} i @gpu-components/core @gpu-components/react
            {'\n\n'}
            {c('# copied into your repo — yours to edit, shaders included')}
            {'\n'}
            {fn('npx')} gpu-components add timeline
            {'\n\n'}
            {c('# see what upstream changed since you copied it')}
            {'\n'}
            {fn('npx')} gpu-components diff timeline
          </Code>
          <Code file="components/gpu/timeline/">
            {'GPUTimeline.tsx      '}
            {c('// thin React wrapper')}
            {'\n'}
            {'TimelineRenderer.ts  '}
            {c('// create / update / plan / dispose')}
            {'\n'}
            {'viewModel.ts         '}
            {c('// columnar layout + spatial index')}
            {'\n'}
            {'interaction.ts       '}
            {c('// pan / zoom / hover / brush')}
            {'\n'}
            {'a11y.ts              '}
            {c('// semantic model + DOM overlay')}
            {'\n'}
            {'fallback.ts          '}
            {c('// Canvas2D, capped and honest')}
            {'\n'}
            {'shaders/'}
            {'\n'}
            {'  spans.wgsl         '}
            {c('// instanced span quads')}
            {'\n'}
            {'  bin.wgsl           '}
            {c('// LOD density compute')}
            {'\n'}
            {'  overlay.wgsl       '}
            {c('// hover / selection / brush')}
          </Code>
        </Grid>
      </Section>

      {/* ── honesty ────────────────────────────────────────────────────── */}
      <Section
        eyebrow="House rules"
        title="The parts most libraries leave out."
        lead="These are commitments in the plan, not aspirations in a README."
      >
        <Grid cols={3}>
          {HOUSE_RULES.map(([t, b]) => (
            <Card key={t}>
              <Stack gap={8}>
                <H3 sm>{t}</H3>
                <Body sm>{b}</Body>
              </Stack>
            </Card>
          ))}
        </Grid>
      </Section>

      {/* ── cta ────────────────────────────────────────────────────────── */}
      <Section flush>
        <Card lg sx={s.cta}>
          <Stack gap={16}>
            <Eyebrow>Status</Eyebrow>
            <H2>Week 1 is measurement, not code.</H2>
            <Body>
              The first deliverable is a benchmark harness and honest baselines for DOM, Canvas2D
              and WebGL2 — because if the WebGPU advantage is smaller than assumed, that should
              change the plan before it changes the marketing.
            </Body>
            <Row>
              <LinkBtn to="/roadmap" primary>
                See the roadmap
              </LinkBtn>
              <LinkBtn to="/start">Get started</LinkBtn>
            </Row>
            <Small>
              Unvalidated numbers carry a{' '}
              <span {...stylex.props(util.monoSm, tone.amber)}>target</span> label until the harness
              produces the real one.
            </Small>
          </Stack>
        </Card>
      </Section>
    </>
  )
}
