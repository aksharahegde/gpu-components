import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { DepGraphDemo } from '../../../src/components/demos/DepGraphDemo'

export const metadata: Metadata = {
  title: 'GPUDepGraph — gpu-components',
  description:
    'Sugiyama layered dependency graph: CPU layout at ingest, orthogonal edges, GPU draw only.',
}

export default function GPUDepGraphPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUDepGraph"
        title="Dependency graph"
        lead={
          'Hover a package to see its name, click to select it, and follow the back-edges styled where a cycle was broken. The layered layout runs once at ingest — panning and zooming are just viewport uniforms.'
        }
      />
      <Section>
        <DepGraphDemo />
      </Section>
    </>
  )
}
