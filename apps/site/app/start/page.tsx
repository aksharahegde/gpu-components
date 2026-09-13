import type { Metadata } from 'next'
import {
  B,
  Body,
  C,
  Card,
  Code,
  Grid,
  H3,
  Notice,
  PageHead,
  Row,
  Section,
  Small,
  Stack,
  c,
  fn,
  k,
  str,
} from '../../src/ui'
import { LinkBtn } from '../../src/components/LinkBtn'
import { InstallCommand } from '../../src/components/InstallCommand'

export const metadata: Metadata = {
  title: 'Get started — gpu-components',
}

const REQUIREMENTS: Array<[string, string]> = [
  [
    'A WebGPU browser, or not',
    'WebGPU reached Baseline in January 2026, per the Baseline browser-support data. The fallback population is realistically under ten per cent — Linux Firefox, older iOS devices, locked-down enterprise browsers — though we have not measured that ourselves. The Canvas2D fallback covers them at reduced capacity and says so out loud.',
  ],
  [
    'A bundler with the vgpu WGSL loader',
    'Vite, webpack, or Turbopack. Shaders are build-time artefacts — resolved, tree-shaken, validated and source-mapped by vgpu’s loader. `doctor` prints the exact config to add if it is missing.',
  ],
  [
    'React 18+',
    'For now. core is framework-free by CI enforcement, so Vue and Svelte adapters are ~200 lines each. We ship none of them in v1 — the discipline of keeping core React-free is the entire preparation.',
  ],
]

function Start() {
  return (
    <>
      <PageHead
        eyebrow="Get started"
        title="The runtime works. So does the install."
        lead="The runtime and seventeen components are real and run in the playground today, and every command on this page is live on npm right now — not a preview of one."
      />

      <Section flush>
        <Notice variant="amber">
          <B>@gpuc/core, @gpuc/react and @gpuc/cli are on npm at v0.1.</B> This is a young install
          surface, published early on purpose: it is easiest to change before many people depend on
          it, and hardest afterwards. If a command on this page is wrong, that is a bug — open an
          issue.
        </Notice>
      </Section>

      <Section eyebrow="Intended install" title="Two steps, and a third that only checks.">
        <Grid cols={2} gap={24}>
          <Stack gap={20}>
            <Stack gap={8}>
              <InstallCommand
                command="npm i @gpuc/core @gpuc/react"
                label="the runtime install command"
              />
              <Small>The runtime — versioned, upgradeable, not yours to fork.</Small>
            </Stack>
            <Stack gap={8}>
              <InstallCommand
                command="npx @gpuc/cli add timeline"
                label="the component install command"
              />
              <Small>The component — copied into your repo, yours to edit.</Small>
            </Stack>
            <Stack gap={8}>
              <InstallCommand command="npx @gpuc/cli doctor" label="the doctor command" />
              <Small>Checks bundler config, the WGSL loader, and WebGPU availability.</Small>
            </Stack>
            <Body>
              The split is the whole distribution thesis: the runtime is infrastructure you want
              patched, the component is policy you want to change. <C>doctor</C> exists because the
              WGSL loader is the one piece of setup that fails silently — a missing loader looks
              like a broken component rather than a missing build step.
            </Body>
          </Stack>

          <Stack gap={16}>
            <Code file="app.tsx">
              {k('import')} {'{ GPUProvider }'} {k('from')} {str("'@gpuc/react'")}
              {'\n'}
              {k('import')} {'{ GPUTimeline }'} {k('from')} {str("'@/components/gpu/timeline'")}
              {'\n\n'}
              {k('export function')} {fn('Trace')}({'{ spans, tracks }'}) {'{'}
              {'\n  '}
              {k('return')} (
              {'\n    '}
              {'<'}
              {fn('GPUProvider')} fallback={str('"canvas2d"')}
              {'>'}
              {'\n      '}
              {'<'}
              {fn('GPUTimeline')}
              {'\n        '}spans={'{spans}'}
              {'\n        '}tracks={'{tracks}'}
              {'\n        '}onSelectionChange={'{setSelected}'}
              {'\n        '}aria-label={str('"Request trace"')}
              {'\n      '}
              {'/>'}
              {'\n    '}
              {'</'}
              {fn('GPUProvider')}
              {'>'}
              {'\n  );'}
              {'\n'}
              {'}'}
            </Code>
            <Body>
              Note what is absent: no <C>shader</C> prop, no <C>uniforms</C> prop, no{' '}
              <C>renderer</C> prop. Extensibility for GPU experts comes from owning the copied
              source, not from a configuration escape hatch — which keeps the props surface small
              and honest.
            </Body>
          </Stack>
        </Grid>
      </Section>

      <Section
        eyebrow="Data"
        title="Objects are ergonomic. Columns are what scales."
        lead="Both are accepted. The docs will state the conversion cost of the ergonomic one rather than quietly paying it for you."
      >
        <Grid cols={2} gap={24}>
          <Code file="ergonomic.ts">
            {c('// fine up to ~100k. Conversion cost is documented.')}
            {'\n'}
            {k('const')} spans: Span[] = [
            {'\n  '}
            {'{ '}start: {str('0')}, dur: {str('12.4')}, track: {str('0')}, name:{' '}
            {str("'fetchUser'")}
            {' }'},
            {'\n  '}…
            {'\n];'}
          </Code>
          <Code file="columnar.ts">
            {c('// the fast path — zero copy from a worker')}
            {'\n'}
            {k('const')} spans: ColumnarSpans = {'{'}
            {'\n  '}start: {k('new')} {fn('Float64Array')}(n),
            {'\n  '}dur: {k('new')} {fn('Float64Array')}(n),
            {'\n  '}track: {k('new')} {fn('Uint16Array')}(n),
            {'\n  '}category: {k('new')} {fn('Uint8Array')}(n),
            {'\n  '}id: {k('new')} {fn('Uint32Array')}(n),
            {'\n'}
            {'};'}
          </Code>
        </Grid>
      </Section>

      <Section eyebrow="Requirements" title="What you will need.">
        <Grid cols={3}>
          {REQUIREMENTS.map(([t, b]) => (
            <Card key={t}>
              <Stack gap={8}>
                <H3 sm>{t}</H3>
                <Body sm>{b}</Body>
              </Stack>
            </Card>
          ))}
        </Grid>
      </Section>

      <Section
        eyebrow="Before you adopt"
        title="Read the part that tells you not to."
        lead="Every component page will carry a “When NOT to use this” section with a measured crossover number and a recommendation for what to use instead."
      >
        <Grid cols={2} gap={24}>
          <Card lg>
            <Stack gap={12}>
              <H3>Below the crossover, use something else</H3>
              <Body>
                Upload cost and pipeline overhead dominate at small N. The hypothesis is somewhere
                around 20k–50k primitives; the measured number goes in the docs. A library that
                teaches you to reach for the GPU at 500 rows is a worse library than one that tells
                you to use a <C>&lt;table&gt;</C>.
              </Body>
            </Stack>
          </Card>
          <Card lg>
            <Stack gap={12}>
              <H3>Accessibility is not an afterthought here</H3>
              <Body>
                Labels are real DOM text — selectable, copyable, and screen-reader navigable — and
                that same layer is the accessibility tree. Keyboard navigation moves the viewport,
                not just the focus ring, so a keyboard user reaches the whole dataset rather than
                only what happens to be on screen.
              </Body>
            </Stack>
          </Card>
        </Grid>

        <Row>
          <LinkBtn to="/architecture" primary>
            Read the architecture
          </LinkBtn>
          <LinkBtn to="/playground">Try the playground</LinkBtn>
          <LinkBtn to="/why-gpu">Why GPU?</LinkBtn>
        </Row>
      </Section>
    </>
  )
}

export default Start
