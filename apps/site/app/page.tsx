import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import { color } from '../src/tokens.stylex'
import {
  B,
  Body,
  C,
  Card,
  Code,
  Grid,
  H1,
  H2,
  H3,
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
import { heroMotion } from '../src/heroMotion.stylex'

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
    backgroundImage: [
      `radial-gradient(ellipse 58% 48% at 50% 0%, color-mix(in srgb, ${color.accent} 20%, transparent), transparent 68%)`,
      `radial-gradient(ellipse 42% 36% at 72% 18%, color-mix(in srgb, ${color.mint} 9%, transparent), transparent 72%)`,
    ].join(', '),
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
  runtime: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1fr)', [HERO]: 'minmax(0, 1fr)' },
    gap: 24,
    alignItems: 'stretch',
  },
  runtimeList: { display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  delay80: { animationDelay: '80ms' },
  delay160: { animationDelay: '160ms' },
  delay240: { animationDelay: '240ms' },
  delay320: { animationDelay: '320ms' },
  ctaBand: {
    padding: '28px 26px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${color.accent} 28%, ${color.border})`,
    borderRadius: '10px',
    backgroundColor: `color-mix(in srgb, ${color.accent} 5%, ${color.surface})`,
  },
})

function Home() {
  return (
    <>
      <section {...stylex.props(s.hero)}>
        <div {...stylex.props(s.glow, heroMotion.glowIn)} aria-hidden="true" />
        <Wrap sx={s.heroInner}>
          <div {...stylex.props(s.heroGrid)}>
            <Stack gap={24}>
              <Row sx={[heroMotion.rise, s.delay80]}>
                <Status state="live">Runtime & playground live · pre-1.0</Status>
              </Row>
              <H1 sx={[heroMotion.rise, s.delay160]}>
                GPU components that
                <br />
                <span {...stylex.props(tone.accent)}>share one device.</span>
              </H1>
              <Lead sx={[heroMotion.rise, s.delay240]}>
                A framework-independent WebGPU runtime for application components, built on{' '}
                <A href="https://vgpu.sh">vgpu</A>.{' '}
                <span {...stylex.props(tone.accent)}>One device, one frame, one submit</span> — across
                every component on the page.
              </Lead>
              <Row sx={[s.heroCta, heroMotion.rise, s.delay320]}>
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

      <Section title="Built for the surfaces that fall over.">
        <Grid cols={3}>
          <Card>
            <Stack gap={8}>
              <H3 sm>Trace and profile viewers</H3>
              <Body sm>
                A request trace with 200,000 spans, where zooming out means every span is on
                screen at once.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={8}>
              <H3 sm>Observability dashboards</H3>
              <Body sm>
                Six panels mounted at once, each wanting its own canvas, each dropping frames when
                the others animate.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={8}>
              <H3 sm>Dense data surfaces</H3>
              <Body sm>
                Grids, heatmaps and scatter plots past the point where one CPU frame can touch
                every element.
              </Body>
            </Stack>
          </Card>
        </Grid>
      </Section>

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
            <C>GPUTimeline</C> through the same runtime as the playground; published harness
            baselines replace these when they exist, and anything not yet measured stays labelled{' '}
            <span {...stylex.props(util.monoSm, tone.amber)}>target</span>.
          </Notice>
        </Stack>
      </Section>

      <Section
        title="Nobody is building the shared runtime."
        lead="Chart libraries already exist. What does not exist is one shared runtime for timelines, heatmaps, grids and graphs on the same page — with compute in the data path and accessibility built in, not bolted on."
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

          <Card lg sx={s.runtimeList}>
            <List>
              <LI bulletTone="accent">
                <B>One command buffer per tick.</B> Every mounted component’s passes land in a single{' '}
                <C>frame()</C>, compute before render.
              </LI>
              <LI bulletTone="mint">
                <B>Shared caches.</B> Pipelines, samplers, colormaps, and transient uniforms — not one
                set per component.
              </LI>
              <LI bulletTone="amber">
                <B>Honest fallbacks.</B> Every component documents when not to use GPU, with measured
                crossover numbers. See <LinkBtn to="/why-gpu">Why GPU</LinkBtn> and the{' '}
                <LinkBtn to="/components">component matrix</LinkBtn>.
              </LI>
            </List>
          </Card>
        </div>
      </Section>

      <Section flush>
        <div {...stylex.props(s.ctaBand)}>
          <Stack gap={16}>
            <H2>Try it, then decide.</H2>
            <Body>
              The playground runs seventeen components live in your browser. Architecture, distribution,
              and the full candidate scoring live on their own pages when you need the detail.
            </Body>
            <Row sx={s.heroCta}>
              <LinkBtn to="/playground" primary>
                Open the playground
              </LinkBtn>
              <LinkBtn to="/start">Get started</LinkBtn>
            </Row>
            <Small sx={util.narrow}>
              Benchmark numbers on this page are measured here, in your browser. Anything not yet
              measured carries a <span {...stylex.props(util.monoSm, tone.amber)}>target</span>{' '}
              label.
            </Small>
          </Stack>
        </div>
      </Section>
    </>
  )
}

export default Home
