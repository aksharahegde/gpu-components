import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import { color, font, radius } from '../src/tokens.stylex'
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
import { LinkBtn } from '../src/components/LinkBtn'
import { InstallCommand } from '../src/components/InstallCommand'
import { Showcase } from '../src/components/Showcase'
import { ComponentGallery } from '../src/components/ComponentGallery'
import { HeroStage, LandingGpu } from '../src/components/HeroStage'
import { HeroJourney } from '../src/components/hero3d/HeroJourney'
import { heroMotion } from '../src/heroMotion.stylex'

export const metadata: Metadata = {
  title: 'gpu-components — data surfaces that do not fall over',
  description:
    'A WebGPU runtime and component registry for the data surfaces that break DOM and Canvas2D — timelines, grids, heatmaps, scatter plots. One device, one frame, one submit.',
}

/** Inlined rather than shared — see `src/ui.tsx`'s equivalent comment. */
const HERO = '@media (max-width: 940px)'

const s = stylex.create({
  /**
   * `overflow: hidden` is load-bearing: the hero stage deliberately runs past the right viewport
   * edge (see `HeroStage`'s stage comment), and this is what clips the overhang so the page never
   * gains a horizontal scrollbar.
   */
  hero: {
    position: 'relative',
    paddingBlock: '76px 64px',
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  /**
   * The drawn-grid backdrop that lived here was decoration gesturing at "canvas"; the live render
   * on the right is the canvas, so the backdrop went. Text left, GPU surface right — the surface
   * column is slightly narrower because the headline is the argument and the render is the
   * evidence, not the other way round.
   */
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 11fr) minmax(0, 9fr)', [HERO]: 'minmax(0, 1fr)' },
    gap: { default: 48, [HERO]: 36 },
    alignItems: 'center',
  },
  /**
   * The plan's legibility argument ("`Card` is opaque, `Section` isn't, so text stays readable
   * against the sticky scene") holds for sections 2-4, whose text lives inside a `Card` — but the
   * hero's own text column is a bare `Stack`, never a `Card`, so it had zero backing against the
   * moving scene directly behind it. Same recipe as `Chrome.tsx`'s sticky header
   * (`color-mix` translucent surface + `backdropFilter: blur()`, the one other `backdrop-filter`
   * user in this app) rather than a flat opaque `Card`: a hard white rectangle over a 3D scene reads
   * as a bug patch, a blurred panel reads as an intentional glass layer that happens to sit over
   * the render.
   */
  heroText: {
    minWidth: 0,
    position: 'relative',
    zIndex: 1,
    padding: '28px 26px',
    borderRadius: radius.lg,
    backgroundColor: `color-mix(in srgb, ${color.surface} 88%, transparent)`,
    backdropFilter: 'blur(16px)',
  },
  heroCta: { gap: 10 },
  install: { maxWidth: 520 },

  stats: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(3, minmax(0, 1fr))', [HERO]: 'minmax(0, 1fr)' },
    gap: 16,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '20px 22px',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
  },
  statValue: {
    fontFamily: font.mono,
    fontSize: 'clamp(24px, 3vw, 30px)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
    color: color.text,
  },
  statLabel: { fontSize: 14, lineHeight: 1.5, color: color.textDim },

  kicker: {
    fontSize: 'clamp(17px, 1.7vw, 20px)',
    lineHeight: 1.5,
    letterSpacing: '-0.015em',
    color: color.text,
    fontWeight: 560,
    maxWidth: '60ch',
  },
  /**
   * Same bare-text-over-the-sticky-scene bug `s.heroText` above fixes for the hero, found on the
   * kicker line inside the journey's "Everybody writes this UI three times" section (not wrapped
   * in a `Card` like the stat callouts right above it, so a scene square could cross behind it) —
   * same translucent/blurred backing, same token values, for the same reason. Only applied where
   * a kicker actually sits inside `<HeroJourney>` (this section's); the other `s.kicker` use below
   * is past `</HeroJourney>`, off the sticky scene, and doesn't need it.
   */
  kickerPanel: {
    position: 'relative',
    zIndex: 1,
    padding: '28px 26px',
    borderRadius: radius.lg,
    backgroundColor: `color-mix(in srgb, ${color.surface} 88%, transparent)`,
    backdropFilter: 'blur(16px)',
  },

  split: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1fr)', [HERO]: 'minmax(0, 1fr)' },
    gap: 24,
    alignItems: 'stretch',
  },
  listCard: { display: 'flex', flexDirection: 'column', justifyContent: 'center' },

  antiSell: {
    padding: '30px 28px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${color.amber} 32%, ${color.border})`,
    borderRadius: radius.lg,
    backgroundColor: `color-mix(in srgb, ${color.amber} 6%, ${color.surface})`,
  },
  ctaBand: {
    padding: '30px 28px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${color.accent} 28%, ${color.border})`,
    borderRadius: radius.lg,
    backgroundColor: `color-mix(in srgb, ${color.accent} 5%, ${color.surface})`,
  },
})

/**
 * Figures on this page trace to something that exists: both ceilings are the numbers `/why-gpu`
 * already publishes, and the draw-call figure is what `GPUScatter` actually does. The crossover in
 * the anti-sell section below is deliberately named without a number — it is still a hypothesis in
 * `PLAN.md`, and `PRODUCT.md` forbids printing one the harness has not produced.
 */
const CEILINGS: Array<[string, string]> = [
  ['~5,000', 'DOM nodes one frame can touch'],
  ['~50,000', 'Canvas2D fillRects at 60fps'],
  ['1', 'draw call, for 250,000 scatter points'],
]

function Home() {
  return (
    <LandingGpu>
      <HeroJourney>
      <section {...stylex.props(s.hero)}>
        <Wrap>
          <div {...stylex.props(s.heroGrid)}>
            {/*
              * One rise for the whole text block, not five staggered ones: the second thing to
              * appear should be the render resolving on the right, and a five-step cascade was
              * spending the viewer's first second on choreography instead.
              */}
            <Stack gap={24} sx={[s.heroText, heroMotion.rise]}>
              <Row>
                <Status state="live">Runtime and 17 components live · pre-1.0</Status>
              </Row>
              {/*
                * No explicit <br/>: the hard break left "nodes." stranded on a line of its own at
                * desktop width. `text-wrap: balance` on H1 distributes the two sentences evenly at
                * whatever measure the viewport gives, which is what the break was trying to do by
                * hand.
                */}
              <H1>
                This isn&rsquo;t a preview of the GPU web.{' '}
                <span {...stylex.props(tone.accent)}>It&rsquo;s running.</span>
              </H1>
              <Lead>
                Seventeen components, built on one shared WebGPU runtime, pre-1.0 and already
                drawing. Four of them are running together further down this page — one device,
                one frame, one submit — and every one of the seventeen has a live demo you can
                open.
              </Lead>
              <Row sx={s.heroCta}>
                <LinkBtn to="/playground" primary>
                  Try the playground
                </LinkBtn>
                <LinkBtn to="/start">Get started</LinkBtn>
              </Row>
              <Stack gap={8} sx={s.install}>
                <InstallCommand
                  command="npx gpu-components add timeline"
                  label="the install command"
                />
                <Small>
                  The component is copied into your repo, yours to edit; the runtime stays a
                  versioned dependency. Nothing is on npm yet — the install surface is published
                  early so it can be argued with while changing it is cheap.
                </Small>
              </Stack>
            </Stack>
            <HeroStage />
          </div>
        </Wrap>
      </section>

      <Section
        title="The DOM is out of headroom. The GPU is barely awake."
        lead="WebGPU reached Baseline in January 2026. The fastest chip in the machine is now a standard browser API, and it spends most of its life compositing rectangles while your interface drops frames next to it."
      >
        <Grid cols={3}>
          <Card>
            <Stack gap={8}>
              <H3 sm>Baseline, not experimental.</H3>
              <Body sm>
                Chrome and Edge since 113. Safari 26. Firefox 141 on Windows, 145 on macOS Tahoe
                ARM. Shipped, not proposed.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={8}>
              <H3 sm>Under ten per cent left behind.</H3>
              <Body sm>
                Linux Firefox, older iOS, locked-down enterprise browsers. They get the Canvas2D
                path at reduced capacity and are told so. Our estimate — we have not measured it
                ourselves.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={8}>
              <H3 sm>Charts shipped. Runtimes didn&rsquo;t.</H3>
              <Body sm>
                One WebGPU chart is a weekend. A shared device under six different components is
                the part nobody built.
              </Body>
            </Stack>
          </Card>
        </Grid>
      </Section>

      <Section title="Everybody writes this UI three times.">
        <Stack gap={28}>
          <Body>
            First in DOM. Fine at a thousand rows, dead at five thousand — that is roughly the
            ceiling on primitives one JS frame can issue. So you rewrite it in Canvas2D and buy an
            order of magnitude: about fifty thousand <C>fillRect</C>s at 60fps. Then the data
            grows again. Both ceilings are properties of drawing from a CPU loop, and no version
            of either platform raises them.
          </Body>
          <div {...stylex.props(s.stats)}>
            {CEILINGS.map(([value, label]) => (
              <div key={label} {...stylex.props(s.stat)}>
                <span {...stylex.props(s.statValue)}>{value}</span>
                <span {...stylex.props(s.statLabel)}>{label}</span>
              </div>
            ))}
          </div>
          <p {...stylex.props(s.kicker, s.kickerPanel)}>
            Nobody budgets for the third rewrite. Nobody has to do a fourth — above this one, the
            ceiling is the hardware.
          </p>
        </Stack>
      </Section>

      <Section
        title="Zoom is a uniform write, not a re-render."
        lead="A CPU pipeline re-walks the whole dataset on every pan, zoom, filter and brush. A GPU pipeline uploads it once. After that, interaction changes a few dozen bytes of uniform and the frame redraws from data that never moved — the dataset stopped being in the interaction path."
      >
        <Grid cols={3}>
          <Card>
            <Stack gap={8}>
              <H3 sm>Per-element work runs on the hardware built for it</H3>
              <Body sm>
                Colour mapping, normalisation, thresholding, LOD binning, min/max reduction —
                data-parallel work, run data-parallel.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={8}>
              <H3 sm>Selection is a bitset the shader branches on</H3>
              <Body sm>
                Brushing a hundred thousand spans does not mean touching a hundred thousand objects.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={8}>
              <H3 sm>Compute lives in the data path, not beside it</H3>
              <Body sm>
                Indirect dispatch and storage-buffer-driven vertex work are the durable WebGPU
                advantages. Fill rate is not.
              </Body>
            </Stack>
          </Card>
        </Grid>
      </Section>
      </HeroJourney>

      <Section
        title="Here are four of them. One device."
        lead="Six GPU panels on a page usually means six GPU devices, and that is the bug this project started from. Chart libraries exist; WebGPU charting already shipped. What does not exist is one runtime underneath components that are not alike — a timeline, a heatmap, a grid and a scatter plot on the same page, through one device, one frame loop, one submit."
      >
        <Stack gap={28}>
          <Showcase />
          <div {...stylex.props(s.split)}>
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
            <Card lg sx={s.listCard}>
              <List>
                <LI bulletTone="accent">
                  <B>One command buffer per tick.</B> Every mounted component&rsquo;s passes land in
                  a single <C>frame()</C>, compute before render.
                </LI>
                <LI bulletTone="mint">
                  <B>Shared caches.</B> Pipelines, samplers, colormaps and transient uniforms exist
                  once, not once per component.
                </LI>
                <LI bulletTone="amber">
                  <B>React never owns GPU state.</B> Render state lives in refs and GPU buffers;
                  React state is for semantics — selected ids, labels, the accessibility tree.
                </LI>
              </List>
            </Card>
          </div>
        </Stack>
      </Section>

      <Section
        title="You own the component. We own the plumbing."
        lead="The runtime is infrastructure nobody wants to fork and everybody wants patched — device management, scheduling, leak fixes, device-loss handling. The component is policy: colours, LOD thresholds, label rules, interaction feel, shaders. That is exactly what teams need to change and what a props API can never anticipate."
      >
        <Stack gap={20}>
          <div {...stylex.props(s.split)}>
            <Stack gap={10}>
              <InstallCommand
                command="npm i @gpu-components/core @gpu-components/react"
                label="the runtime install command"
              />
              <Small>Versioned, upgradeable, not yours to fork.</Small>
            </Stack>
            <Stack gap={10}>
              <InstallCommand
                command="npx gpu-components add timeline"
                label="the component install command"
              />
              <Small>Copied into your repo, yours to edit.</Small>
            </Stack>
          </div>
          <p {...stylex.props(s.kicker)}>
            No <C>shader</C> prop. No <C>renderer</C> prop. No <C>uniforms</C> prop. Extensibility
            comes from owning the source, not from an escape hatch.
          </p>
        </Stack>
      </Section>

      <Section flush>
        <div {...stylex.props(s.antiSell)}>
          <Stack gap={16}>
            <H2>Below the crossover, this library is slower than what you already have.</H2>
            <Body>
              Upload cost and pipeline overhead dominate at small N. Every component ships a section
              titled &ldquo;When NOT to use this&rdquo;, with the measured crossover number and a
              recommendation for what to use instead. Canvas2D is better than most people assume: a
              canvas grid already scrolls millions of rows at 60fps today, and anyone selling you a
              GPU grid on scroll performance is selling you something you already have.
            </Body>
            <Small sx={util.wide}>
              We publish the comparison whether or not it flatters us. Anything not yet measured on
              the harness carries a <span {...stylex.props(util.monoSm, tone.amber)}>target</span>{' '}
              label, on every page.
            </Small>
            <Row sx={s.heroCta}>
              <LinkBtn to="/why-gpu">Read the six-question gate</LinkBtn>
              <LinkBtn to="/components">See the scoring</LinkBtn>
            </Row>
          </Stack>
        </div>
      </Section>

      <Section title="Seventeen components. All seventeen running live, right now, on your GPU.">
        <ComponentGallery />
      </Section>

      <Section flush>
        <div {...stylex.props(s.ctaBand)}>
          <Stack gap={16}>
            <H2>You&rsquo;ve seen four of them run. There are seventeen.</H2>
            <Body>
              The playground runs every component live, on your GPU, on your machine. Architecture,
              the scoring matrix, and the full &ldquo;why not&rdquo; live on their own pages when you
              want the detail.
            </Body>
            <Row sx={s.heroCta}>
              <LinkBtn to="/playground" primary>
                Open the playground
              </LinkBtn>
              <LinkBtn to="/architecture">Read the architecture</LinkBtn>
            </Row>
          </Stack>
        </div>
      </Section>
    </LandingGpu>
  )
}

export default Home
