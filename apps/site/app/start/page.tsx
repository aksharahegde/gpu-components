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
  Stack,
  c,
  fn,
  k,
  str,
} from '../../src/ui'
import { LinkBtn } from '../../src/components/LinkBtn'

export const metadata: Metadata = {
  title: 'Get started — gpu-components',
}

const REQUIREMENTS: Array<[string, string]> = [
  [
    'A WebGPU browser, or not',
    'WebGPU reached Baseline in January 2026. The realistic fallback population is ~5–10%: Linux Firefox, older iOS devices, locked-down enterprise browsers. The Canvas2D fallback covers them at reduced capacity and says so out loud.',
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
        title="Nothing is published yet."
        lead="This page documents the intended surface so it can be argued with before it is built. Every command below will fail today, on purpose."
      />

      <Section flush>
        <Notice variant="amber">
          <B>Status: pre-implementation.</B> No package has been published and no component exists.
          The plan is public specifically so the API can be criticised while changing it is still
          cheap. If something here looks wrong, that is the most useful thing you can tell us right
          now.
        </Notice>
      </Section>

      <Section eyebrow="Intended install" title="Two steps, and they do different things.">
        <Grid cols={2} gap={24}>
          <Stack gap={16}>
            <Code file="terminal">
              {c('# 1. the runtime — versioned, upgradeable, not yours to fork')}
              {'\n'}
              {fn('npm')} i @gpu-components/core @gpu-components/react
              {'\n\n'}
              {c('# 2. the component — copied into your repo, yours to edit')}
              {'\n'}
              {fn('npx')} gpu-components add timeline
              {'\n\n'}
              {c('# check bundler config, WGSL loader, WebGPU availability')}
              {'\n'}
              {fn('npx')} gpu-components doctor
            </Code>
            <Body>
              The split is the whole distribution thesis. The runtime is infrastructure nobody wants
              to fork and everybody wants patched — device management, scheduling, leak fixes,
              device-loss handling. The component is policy: colours, LOD thresholds, label rules,
              interaction feel, shaders. That is exactly what teams need to change and what a props
              API can never anticipate.
            </Body>
          </Stack>

          <Stack gap={16}>
            <Code file="app.tsx">
              {k('import')} {'{ GPUProvider }'} {k('from')} {str("'@gpu-components/react'")}
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
