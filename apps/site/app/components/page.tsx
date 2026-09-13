import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import {
  B,
  Body,
  C,
  Card,
  Grid,
  H3,
  Notice,
  PageHead,
  Row,
  Section,
  Stack,
  Status,
  Table,
  TableScroll,
  Td,
  Th,
  tone,
} from '../../src/ui'
import { LinkBtn } from '../../src/components/LinkBtn'

export const metadata: Metadata = {
  title: 'Components — gpu-components',
}

type Tag = 'live' | 'progress' | 'variant' | 'planned'

const MATRIX: Array<[string, number, number, number, number, number, Tag]> = [
  ['GPUTimeline', 9, 9, 9, 9, 147.0, 'live'],
  ['GPUFlameGraph', 8, 8, 8, 8, 139.0, 'variant'],
  ['GPUScatter', 9, 8, 8, 5, 136.0, 'live'],
  ['GPUHeatmap', 8, 7, 8, 6, 131.0, 'live'],
  ['GPUDataGrid', 6, 8, 10, 9, 129.5, 'live'],
  ['GPUImageDiff', 9, 5, 7, 6, 120.5, 'live'],
  ['GPULogViewer', 6, 7, 9, 8, 119.5, 'live'],
  ['GPUCandlestick', 8, 6, 8, 3, 119.0, 'live'],
  ['GPUGraph', 9, 6, 7, 4, 118.0, 'live'],
  ['GPUDensityMap', 9, 6, 8, 3, 114.5, 'live'],
  ['GPUHistogram', 7, 6, 7, 4, 112.5, 'live'],
  ['GPUDepGraph', 7, 5, 7, 6, 110.0, 'live'],
  ['GPUNetworkTopology', 7, 5, 6, 5, 102.0, 'live'],
  ['GPUAnnotationCanvas', 6, 5, 7, 5, 99.0, 'live'],
  ['GPUSpreadsheet', 5, 5, 8, 9, 97.5, 'live'],
  ['GPUNodeEditor', 4, 6, 8, 5, 97.0, 'live'],
  ['GPUWhiteboard', 5, 6, 7, 4, 95.0, 'live'],
  ['GPUPdfViewer', 5, 4, 8, 7, 92.5, 'live'],
]

const TAG: Record<Tag, { label: string; state: 'planned' | 'progress' | 'live' }> = {
  live: { label: 'live demo', state: 'live' },
  progress: { label: 'in progress', state: 'progress' },
  variant: { label: 'same primitive', state: 'planned' },
  planned: { label: 'planned', state: 'planned' },
}

const FORCES: Array<[string, string]> = [
  ['Instanced quad renderer with per-instance storage buffer', 'Spans'],
  ['Viewport uniform — pan/zoom without a data re-walk', 'Time axis + track scroll'],
  ['Compute pass, storage buffers, workgroup tuning', 'LOD density binning'],
  ['Indirect dispatch and draw', 'Variable visible counts, no CPU readback'],
  ['Reduction', 'Auto-range, per-track min/max, histogram'],
  ['Selection mask buffer', 'Brush and multi-select over 100k+ spans'],
  ['Async picking + CPU spatial index', 'Hover and click'],
  ['Multi-pass frame', 'Zoomed-out LOD compositing'],
  ['Semantic DOM overlay', 'Labels and accessibility — the same layer'],
  ['Fallback renderer', 'Canvas2D quads + labels, a small honest surface'],
]

function Components() {
  return (
    <>
      <PageHead
        eyebrow="Components"
        title="Eighteen candidates, scored, and one chosen."
        lead="Weights encode this project's priorities: we are building a runtime first, so reusable primitives and GPU necessity outrank raw market size."
      />

      <Section
        eyebrow="Matrix"
        title="The scoring, in full."
        lead="Weights: GPU necessity ×3 · reusable primitives ×3 · usefulness ×2.5 · differentiation ×2.5 · feasibility ×2 · demonstrable delta ×2 · adoption ×1.5 · fallback risk ×1."
      >
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>GPU need</Th>
                <Th>Reuse</Th>
                <Th>Useful</Th>
                <Th>Diff</Th>
                <Th>Weighted</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map(([name, gpu, reuse, useful, diff, score, tag], i) => {
                const t = TAG[tag]
                const last = i === MATRIX.length - 1
                const top = score >= 129
                return (
                  <tr key={name}>
                    <Td last={last} mono>
                      <B>{name}</B>
                    </Td>
                    <Td last={last} mono>
                      {gpu}
                    </Td>
                    <Td last={last} mono>
                      {reuse}
                    </Td>
                    <Td last={last} mono>
                      {useful}
                    </Td>
                    <Td last={last} mono>
                      {diff}
                    </Td>
                    <Td last={last} mono>
                      <span {...stylex.props(top && tone.mint)}>
                        <B>{score.toFixed(1)}</B>
                      </span>
                    </Td>
                    <Td last={last}>
                      <Status state={t.state}>{t.label}</Status>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </TableScroll>

        <Notice variant="amber">
          <B>Note the shape of the GPUDataGrid row.</B> It scores highest on usefulness and
          adoption and loses on feasibility and demonstrable performance delta. The weighting did
          not produce that shape; the candidate did.
        </Notice>
      </Section>

      <Section eyebrow="First component" title="What GPUTimeline forces the runtime to have.">
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Runtime subsystem</Th>
                <Th>Forced by</Th>
              </tr>
            </thead>
            <tbody>
              {FORCES.map(([a, b], i) => {
                const last = i === FORCES.length - 1
                return (
                  <tr key={a}>
                    <Td last={last}>
                      <B>{a}</B>
                    </Td>
                    <Td last={last}>{b}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </TableScroll>

        <Notice variant="accent">
          <B>The architecture test was GPUHeatmap, not GPUDataGrid.</B> The falsifiable claim was
          that the heatmap would ship requiring <em>zero</em> changes to{' '}
          <C>@gpu-components/core</C>. It needed exactly one — a second axis on the viewport —
          which is close enough to count and specific enough to be worth knowing. The abstraction
          held.
        </Notice>
      </Section>

      <Section eyebrow="Rejected" title="What we are not building, and why that is a feature.">
        <Grid cols={2}>
          <Card>
            <Stack gap={12}>
              <H3 sm>Charts</H3>
              <Body sm>
                WebGPU charting already shipped, including a shadcn-installable registry.
                That slot is taken and fighting for it is a distraction. The categories a chart
                abstraction cannot reach — dense interactive timelines, grids, trace surfaces — are
                the ones that are open.
              </Body>
            </Stack>
          </Card>
          <Card>
            <Stack gap={12}>
              <H3 sm>Decorative anything</H3>
              <Body sm>
                Particle backgrounds, shader wallpapers, animated blobs, generic 3D scene viewers.
                They fail the gate: no data-scale problem, and no primitive that another
                application component needs. vgpu already ships a 3D scene module and duplicating
                it is an explicit non-goal.
              </Body>
            </Stack>
          </Card>
        </Grid>

        <Row>
          <LinkBtn to="/playground" primary>
            Try the playground
          </LinkBtn>
          <LinkBtn to="/why-gpu">Why GPU?</LinkBtn>
        </Row>
      </Section>
    </>
  )
}

export default Components
