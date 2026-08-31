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
  Small,
  Stack,
  Status,
  Table,
  TableScroll,
  Td,
  Th,
  tone,
  util,
} from '../../src/ui'
import { LinkBtn } from '../../src/components/LinkBtn'

export const metadata: Metadata = {
  title: 'Components — gpu-components',
}

type Tag = 'mvp' | 'variant' | 'p5' | 'p7' | 'later' | 'no'

const MATRIX: Array<[string, number, number, number, number, number, Tag]> = [
  ['GPUTimeline', 9, 9, 9, 9, 147.0, 'mvp'],
  ['GPUFlameGraph', 8, 8, 8, 8, 139.0, 'variant'],
  ['GPUScatter', 9, 8, 8, 5, 136.0, 'p7'],
  ['GPUHeatmap', 8, 7, 8, 6, 131.0, 'p5'],
  ['GPUDataGrid', 6, 8, 10, 9, 129.5, 'p5'],
  ['GPUImageDiff', 9, 5, 7, 6, 120.5, 'later'],
  ['GPULogViewer', 6, 7, 9, 8, 119.5, 'later'],
  ['GPUCandlestick', 8, 6, 8, 3, 119.0, 'no'],
  ['GPUGraph', 9, 6, 7, 4, 118.0, 'p7'],
  ['GPUDensityMap', 9, 6, 8, 3, 114.5, 'later'],
  ['GPUHistogram', 7, 6, 7, 4, 112.5, 'later'],
  ['GPUDepGraph', 7, 5, 7, 6, 110.0, 'later'],
  ['GPUNetworkTopology', 7, 5, 6, 5, 102.0, 'later'],
  ['GPUAnnotationCanvas', 6, 5, 7, 5, 99.0, 'later'],
  ['GPUSpreadsheet', 5, 5, 8, 9, 97.5, 'later'],
  ['GPUNodeEditor', 4, 6, 8, 5, 97.0, 'later'],
  ['GPUWhiteboard', 5, 6, 7, 4, 95.0, 'later'],
  ['GPUPdfViewer', 5, 4, 8, 7, 92.5, 'later'],
]

const TAG: Record<Tag, { label: string; state: 'planned' | 'progress' }> = {
  mvp: { label: 'MVP · phase 2', state: 'progress' },
  variant: { label: 'same primitive', state: 'planned' },
  p5: { label: 'phase 5', state: 'planned' },
  p7: { label: 'phase 7', state: 'planned' },
  later: { label: 'backlog', state: 'planned' },
  no: { label: 'not planned', state: 'planned' },
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
        eyebrow="Decision"
        title="GPUTimeline first. GPUDataGrid second."
        lead="The stated hypothesis was DataGrid → runtime → Graph. Two of those three changed, and the reasoning is the most load-bearing part of the plan."
      >
        <Grid cols={3}>
          <Card lg>
            <Stack gap={12}>
              <Row>
                <Status state="progress">Chosen · phase 2</Status>
              </Row>
              <H3>GPUTimeline</H3>
              <Body sm>
                Traces, spans, flame graphs, Gantt, waterfalls — one primitive. GPU necessity is
                unarguable, the label budget is bounded by screen width, and it produces every
                primitive the grid will later need.
              </Body>
              <Small>
                Score{' '}
                <span {...stylex.props(util.tabular, tone.mint)}>
                  <B>147.0</B>
                </span>
              </Small>
            </Stack>
          </Card>
          <Card lg>
            <Stack gap={12}>
              <Row>
                <Status state="planned">Deferred · phase 5</Status>
              </Row>
              <H3>GPUDataGrid</H3>
              <Body sm>
                Highest usefulness (10) and adoption (10) of any candidate — and lowest feasibility
                (4). Its render cost is glyph raster bounded by the viewport, which is why Canvas2D
                grids already scroll millions of rows. The honest GPU wins are in the data path.
              </Body>
              <Small>
                Score <B>129.5</B>
              </Small>
            </Stack>
          </Card>
          <Card lg>
            <Stack gap={12}>
              <Row>
                <Status state="planned">Demoted · phase 7</Status>
              </Row>
              <H3>GPUGraph</H3>
              <Body sm>
                GPU force layout at ~1M nodes is already solved well in WebGL. A WebGPU rewrite is
                the lowest-differentiation option, force layout is poorly deterministic (bad for
                snapshot tests), and it yields the fewest reusable primitives.
              </Body>
              <Small>
                Score <B>118.0</B>
              </Small>
            </Stack>
          </Card>
        </Grid>
      </Section>

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
          adoption and loses on feasibility and demonstrable performance delta. That is not an
          artefact of the weighting — it is the finding.
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
          <B>The architecture test is GPUHeatmap, not GPUDataGrid.</B> Phase 5's acceptance
          criterion is a falsifiable claim: the heatmap ships requiring <em>zero</em> changes to{' '}
          <C>@gpu-components/core</C>. If it does not, the runtime abstraction was wrong, and we
          learn that in a week rather than after a month of grid work.
        </Notice>
      </Section>

      <Section eyebrow="Rejected" title="What we are not building, and why that is a feature.">
        <Grid cols={2}>
          <Card>
            <Stack gap={12}>
              <H3 sm>Charts</H3>
              <Body sm>
                WebGPU charting shipped in early 2026, including a shadcn-installable registry.
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
