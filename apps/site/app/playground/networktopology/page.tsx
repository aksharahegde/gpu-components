import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { NetworkTopologyDemo } from '../../../src/components/demos/NetworkTopologyDemo'

export const metadata: Metadata = {
  title: 'GPUNetworkTopology — gpu-components',
  description: 'Force-laid service mesh with status, link health, and traffic pulse. Demo-only for now — the layout animation can still stutter in some browsers.',
}

export default function GPUNetworkTopologyPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUNetworkTopology"
        title="Service mesh, force-laid"
        lead={'Switch between the region/AZ/service schematic and the flat 4,000-host stress mesh, and watch the hot links pulse along their length on a clock independent of the layout. Hover is not wired up here, for the same reason as the force-directed graph: positions live only on the GPU.'}
      />
      <Section>
        <NetworkTopologyDemo />
      </Section>
    </>
  )
}
