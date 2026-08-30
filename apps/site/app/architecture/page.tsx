import type { Metadata } from 'next'
import {
  B,
  Body,
  C,
  Card,
  Code,
  Grid,
  H3,
  LI,
  List,
  Notice,
  PageHead,
  Section,
  Stack,
  Table,
  TableScroll,
  Td,
  Th,
  c,
  fn,
  k,
  str,
} from '../../src/ui'
import { Layers } from '../../src/components/Layers'

export const metadata: Metadata = {
  title: 'Architecture — gpu-components',
}

const LIFECYCLE: Array<[string, string]> = [
  [
    'create + initialize',
    'Merged. Two-phase construction exists to defer async work; ours is synchronous because the device is ready before any component mounts.',
  ],
  [
    'prepare',
    'Rejected. Its job is CPU culling and sorting. Our culling is GPU-side and our sorting happened once at ingest — it would be empty on every component.',
  ],
  [
    'update',
    'Kept. The props boundary, and where the no-pipelines-outside-create rule is enforced.',
  ],
  [
    'compute + render',
    'Merged into plan(). Separating them forces a component to know the scheduler’s ordering; returning both lets the scheduler order globally.',
  ],
  [
    'postRender',
    'Rejected. Its uses are readback and profiling — readback is off the hot path by policy, profiling is the runtime’s job.',
  ],
  ['dispose', 'Kept, and must be idempotent.'],
]

const PRIMITIVES: Array<[string, string]> = [
  [
    'InstancedQuadLayer',
    'The workhorse. Per-instance attributes in a storage buffer, one draw for millions of quads, zero vertex buffers.',
  ],
  [
    'LineLayer',
    'Instanced quads expanded to screen-space thick lines in the vertex stage — axis rules, connectors, edges.',
  ],
  [
    'RasterLayer',
    'A texture drawn through a full-screen effect with a colormap. LOD density fields and heatmaps.',
  ],
  [
    'LabelLayer',
    'v1: DOM overlay, which doubles as the accessibility layer. v2: glyph atlas, when a component needs more than ~400 labels.',
  ],
]

function Architecture() {
  return (
    <>
      <PageHead
        eyebrow="Architecture"
        title="One device, a scheduler, and four primitives."
        lead="The design is deliberately small. Four of the nine subsystems a runtime like this usually grows are already vgpu's, and building them again would be duplication with a version number on it."
      />

      <Section eyebrow="Layers" title="Who owns what.">
        <Grid cols={2} gap={32}>
          <Layers />
          <Stack gap={16}>
            <Body>
              <C>@gpu-components/core</C> is framework-free and must compile with React uninstalled
              — enforced in CI by a lint rule, not by good intentions. <C>@gpu-components/react</C>{' '}
              is an adapter with three hooks and no GPU state. Components are not a package at all:
              they are source copied into your repo.
            </Body>
            <Body>
              Cut from the original sketch, with reasons: <C>renderer</C> (vgpu's <C>draw</C>/
              <C>effect</C> <em>are</em> the renderer), <C>runtime</C> (merged into core),{' '}
              <C>shaders</C> (split into a shared WGSL package and per-component copied shaders),
              and <C>components</C> (registry source instead).
            </Body>
          </Stack>
        </Grid>
      </Section>

      <Section
        eyebrow="Shared context"
        title="One device, many canvases, one frame."
        lead="This is idiomatic vgpu rather than a workaround — its own docs show multi-canvas rendering from a single context, and a canvas may host exactly one live Surface, which maps cleanly onto one component per canvas."
      >
        <Grid cols={2} gap={24}>
          <Code file="core/scheduler.ts">
            {fn('frameLoop')}(runtime.gpu, (f) ={'>'} {'{'}
            {'\n  '}
            {c('// one shared uniform write for the whole page')}
            {'\n  '}
            runtime.globals.{fn('set')}({'{ time, dpr }'});
            {'\n\n  '}
            {k('const')} plans = components
            {'\n    '}.{fn('filter')}(cmp ={'>'} cmp.dirty || cmp.animating)
            {'\n    '}.{fn('map')}(cmp ={'>'} cmp.{fn('plan')}(frameCtx));
            {'\n\n  '}
            {c('// all compute before all render — across components')}
            {'\n  '}
            {k('for')} ({k('const')} p {k('of')} plans)
            {'\n    '}
            {k('for')} ({k('const')} pass {k('of')} p.computePasses) pass.{fn('dispatch')}();
            {'\n\n  '}
            {k('for')} ({k('const')} p {k('of')} plans)
            {'\n    '}
            {k('for')} ({k('const')} pass {k('of')} p.renderPasses)
            {'\n      '}f.{fn('pass')}({'{ target: pass.target, timer: profiler.span(pass.name) }'},
            {'\n             '}(enc) ={'>'} pass.{fn('encode')}(enc));
            {'\n'}
            {'}'});
          </Code>

          <Stack gap={16}>
            <Card>
              <Stack gap={8}>
                <H3 sm>What the scheduler buys</H3>
                <List sm>
                  <LI>One command buffer and one submit per page tick, at any component count</LI>
                  <LI>Global ordering — a binning pass cannot land after a consumer's draw</LI>
                  <LI>
                    Clean components contribute nothing; a static page costs no GPU work
                  </LI>
                  <LI>
                    A profiler span per pass, so "which component blew the budget" is answerable
                  </LI>
                </List>
              </Stack>
            </Card>
            <Notice variant="amber">
              <B>One real hazard.</B> vgpu throws <C>VGPU-FRAME-REENTRANT</C> if <C>frame()</C> is
              called inside another frame or inside a surface resize callback — and the immediate
              fire on subscription counts. Resize handlers set state for the <em>next</em> frame;
              they never render inline.
            </Notice>
          </Stack>
        </Grid>
      </Section>

      <Section
        eyebrow="Component model"
        title="Four methods, and a justification for every rejection."
        lead="The eight-stage lifecycle is over-specified. This is the minimum that actually works."
      >
        <Grid cols={2} gap={24}>
          <Code file="core/component.ts">
            {k('interface')} {fn('GpuComponent')}
            {'<Props> {'}
            {'\n  '}
            {c('/* Allocate stable resources. Once. The ONLY place')}
            {'\n     '}
            {c('pipelines are created. */')}
            {'\n  '}
            {fn('create')}(ctx: ComponentContext): {k('void')};
            {'\n\n  '}
            {c('/* Props changed. May write/resize buffers.')}
            {'\n     '}
            {c('Must NOT create pipelines. Marks dirty. */')}
            {'\n  '}
            {fn('update')}(props: Props): {k('void')};
            {'\n\n  '}
            {c('/* Contribute passes to the shared frame.')}
            {'\n     '}
            {c('Pure: no allocation, no submit. */')}
            {'\n  '}
            {fn('plan')}(frame: FrameContext): RenderPlan;
            {'\n\n  '}
            {c('/* Idempotent — StrictMode will call it twice. */')}
            {'\n  '}
            {fn('dispose')}(): {k('void')};
            {'\n\n  '}
            {c('// optional')}
            {'\n  '}
            {fn('hitTest')}?(x: {k('number')}, y: {k('number')}): HitResult | {k('null')};
            {'\n  '}
            {fn('describe')}?(): SemanticModel;
            {'\n  '}
            {fn('onContextRestored')}?(): {k('void')};
            {'\n'}
            {'}'}
          </Code>

          <TableScroll>
            <Table narrow>
              <thead>
                <tr>
                  <Th>Stage</Th>
                  <Th>Verdict</Th>
                </tr>
              </thead>
              <tbody>
                {LIFECYCLE.map(([stage, verdict], i) => {
                  const last = i === LIFECYCLE.length - 1
                  return (
                    <tr key={stage}>
                      <Td last={last} mono>
                        <B>{stage}</B>
                      </Td>
                      <Td last={last}>{verdict}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </TableScroll>
        </Grid>

        <Notice variant="accent">
          <B>
            <C>plan()</C> is declarative on purpose.
          </B>{' '}
          It returns a description of passes rather than encoding them, which means the scheduler
          can order globally, skip clean components, attach profiler spans uniformly — and a test
          can assert "this component contributes two render passes and one dispatch" without a GPU
          anywhere in sight.
        </Notice>
      </Section>

      <Section eyebrow="Rendering" title="Not a scene graph. Not a frame graph. A pass list.">
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th />
                <Th>Scene graph</Th>
                <Th>Frame graph</Th>
                <Th>Flat pass list — ours</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>
                  <B>Models</B>
                </Td>
                <Td>Hierarchical transforms, materials, culling</Td>
                <Td>Passes as nodes, resources as edges; auto barriers and aliasing</Td>
                <Td>An ordered list of compute + render passes per component</Td>
              </tr>
              <tr>
                <Td>
                  <B>Cost</B>
                </Td>
                <Td>One JS object per drawable — fatal at 1M spans</Td>
                <Td>Resource lifetime analysis, aliasing, pass culling</Td>
                <Td>~200 lines</Td>
              </tr>
              <tr>
                <Td last>
                  <B>What it would buy us</B>
                </Td>
                <Td last>Nothing — 2D data surfaces have a viewport, not a hierarchy</Td>
                <Td last>Aliasing across ~3 transient targets, and barriers WebGPU already handles</Td>
                <Td last>Explicitness, and a trivially debuggable frame</Td>
              </tr>
            </tbody>
          </Table>
        </TableScroll>

        <Grid cols={2} gap={24}>
          <Stack gap={16}>
            <Body>
              A scene graph is categorically wrong here: the data lives in typed arrays and storage
              buffers, not a node tree, and materialising one JS node per span is exactly the
              mistake that makes display-list renderers fail at this scale.
            </Body>
            <Body>
              The upgrade path stays open for free, because a pass <em>declares</em> its inputs and
              outputs even though v1 never reads them. If we ever hit twenty passes with real
              aliasing pressure, the scheduler grows a topological sort and nothing else changes.
            </Body>
          </Stack>
          <Code file="core/plan.ts">
            {k('interface')} {fn('RenderPass')} {'{'}
            {'\n  '}name: {k('string')};
            {'\n  '}target: Target | {str("'surface'")};
            {'\n  '}reads?: ResourceRef[]; {c('// declared, unused in v1')}
            {'\n  '}writes?: ResourceRef[]; {c('// → future auto-ordering')}
            {'\n  '}clear?: ClearColor | {k('false')};
            {'\n  '}scissor?: Rect;
            {'\n  '}
            {fn('encode')}(pass: FramePass): {k('void')};
            {'\n'}
            {'}'}
          </Code>
        </Grid>
      </Section>

      <Section
        eyebrow="Primitives"
        title="Four, and a fifth requires an RFC."
        lead="This boundary is what stops the project becoming an accidental rewrite of a general 2D vector renderer."
      >
        <Grid cols={4}>
          {PRIMITIVES.map(([t, b]) => (
            <Card key={t}>
              <Stack gap={8}>
                <H3 sm>
                  <C>{t}</C>
                </H3>
                <Body sm>{b}</Body>
              </Stack>
            </Card>
          ))}
        </Grid>
      </Section>

      <Section eyebrow="React" title="An adapter, not the runtime.">
        <Grid cols={2} gap={24}>
          <Code file="react/hooks.ts">
            {c('// three hooks. That is the entire surface.')}
            {'\n'}
            {fn('useGpu')}(): GpuRuntime | {k('null')}
            {'\n'}
            {fn('useGpuCanvas')}(opts): {'{ ref, surface, size }'}
            {'\n'}
            {fn('useGpuComponent')}
            {'<P>(factory, props): MountHandle'}
            {'\n\n'}
            {c('// rejected for v1, and why:')}
            {'\n'}
            {c('//   useGPUBuffer / useGPUTexture / useGPUShader')}
            {'\n'}
            {c('//   → they make React’s lifecycle the GPU resource')}
            {'\n'}
            {c('//     lifecycle, which is the coupling we are avoiding')}
          </Code>
          <List>
            <LI>
              <B>
                GPU resources are created in <C>create()</C> and only there.
              </B>{' '}
              Never during React render — a concurrent render may never commit.
            </LI>
            <LI>
              <B>Render state lives in refs and GPU buffers, never React state.</B> A pan gesture
              must cause zero React re-renders; it writes a uniform and marks dirty.
            </LI>
            <LI>
              <B>React state is for semantics</B> — selected ids, visible labels, a11y focus —
              updated at most once per frame, and only when it actually changed.
            </LI>
            <LI>
              <B>StrictMode double-invocation is the leak vector.</B> Idempotent dispose, plus a dev
              registry that counts live GPU objects and warns when a remount increases the count.
              Tested, not hoped.
            </LI>
          </List>
        </Grid>
      </Section>
    </>
  )
}

export default Architecture
