import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { NetworkTopologyDemo } from '../../../src/components/demos/NetworkTopologyDemo'

export const metadata: Metadata = {
  title: 'GPUNetworkTopology — gpu-components',
  description: 'Force-laid service mesh with status, link health, and traffic pulse. Playground-only until the shared force-layout animation defect is fixed.',
}

export default function GPUNetworkTopologyPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUNetworkTopology"
        title="Service mesh, force-laid"
        lead={'Force-laid service mesh with status, link health, and traffic pulse. Playground-only until the shared force-layout animation defect is fixed.'}
      />
      <Section>
        <NetworkTopologyDemo />
      </Section>
    </>
  )
}
