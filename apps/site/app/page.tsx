import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import { color } from '../src/tokens.stylex'
import {
  B,
  Body,
  C,
  Code,
  H1,
  H2,
  Lead,
  LI,
  List,
  Notice,
  Row,
  Section,
  Small,
  Stack,
  Status,
  Wrap,
  c,
  fn,
  k,
  str,
  tone,
  util,
} from '../src/ui'
import { A } from '../src/components/Chrome'
import { LinkBtn } from '../src/components/LinkBtn'
import { Layers } from '../src/components/Layers'
import { SpanBenchmark } from '../src/components/SpanBenchmark'

export const metadata: Metadata = {
  title: 'gpu-components — GPU components that share one device',
}

/** Inlined rather than shared — see `src/ui.tsx`'s equivalent comment. */
const HERO = '@media (max-width: 940px)'

const s = stylex.create({
  hero: {
    position: 'relative',
    paddingBlock: '92px 76px',
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
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
      [HERO]: 'minmax(0, 1fr)',
    },
    gap: { default: 48, [HERO]: 36 },
    alignItems: 'center',
  },
  heroCta: { gap: 10 },
  runtime: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1fr)', [HERO]: 'minmax(0, 1fr)' }, gap: 24 },
})

function Home() {
  return (
    <>
      <section {...stylex.props(s.hero)}>
        <div {...stylex.props(s.glow)} aria-hidden="true" />
        <Wrap sx={s.heroInner}>
          <div {...stylex.props(s.heroGrid)}>
            <Stack gap={24}>
              <Row>
                <Status state="live">Runtime & playground live · pre-1.0</Status>
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
              <Row sx={s.heroCta}>
                <LinkBtn to="/playground" primary>
                  Try the playground
                </LinkBtn>
                <LinkBtn to="/architecture">Read the architecture</LinkBtn>
              </Row>
            </Stack>

            <Layers />
          </div>
        </Wrap>
      </section>

      <Section
        id="ceiling"
        title="Where DOM and Canvas2D actually break."
        lead="Drag the slider and switch renderers. These numbers come from your machine — not from us."
      >
        <Stack gap={24}>
          <SpanBenchmark />
          <Notice variant="amber">
            <B>Read the numbers in context.</B> Canvas2D here is the optimised path — spans are
            pre-grouped by colour. DOM is capped at 20,000 nodes. The WebGPU row runs{' '}
            <C>GPUTimeline</C> through the same runtime as the playground; harness baselines in{' '}
            <C>apps/bench</C> publish when they exist, and anything else stays labelled{' '}
            <span {...stylex.props(util.monoSm, tone.amber)}>target</span>.
          </Notice>
        </Stack>
      </Section>

      <Section
        title="One device. One frame. One submit."
        lead="Chart libraries already exist. Nobody is building one shared runtime for timelines, heatmaps, grids, and graphs on the same page — with compute in the data path and accessibility built in, not bolted on."
      >
        <div {...stylex.props(s.runtime)}>
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
              <B>One command buffer per tick.</B> Every mounted component’s passes land in a single{' '}
              <C>frame()</C>, compute before render.
            </LI>
            <LI>
              <B>Shared caches.</B> Pipelines, samplers, colormaps, and transient uniforms — not one
              set per component.
            </LI>
            <LI>
              <B>Honest fallbacks.</B> Every component documents when not to use GPU, with measured
              crossover numbers. See <LinkBtn to="/why-gpu">Why GPU</LinkBtn> and the{' '}
              <LinkBtn to="/components">component matrix</LinkBtn>.
            </LI>
          </List>
        </div>
      </Section>

      <Section flush>
        <Stack gap={16}>
          <H2>Try it, then decide.</H2>
          <Body>
            The playground runs eight components live in your browser. Architecture, distribution,
            and the full candidate scoring live on their own pages when you need the detail.
          </Body>
          <Row sx={s.heroCta}>
            <LinkBtn to="/playground" primary>
              Open the playground
            </LinkBtn>
            <LinkBtn to="/start">Get started</LinkBtn>
          </Row>
          <Small sx={util.narrow}>
            Benchmark numbers on this page are measured here. Anything not yet produced by{' '}
            <C>apps/bench</C> carries a{' '}
            <span {...stylex.props(util.monoSm, tone.amber)}>target</span> label.
          </Small>
        </Stack>
      </Section>
    </>
  )
}

export default Home
