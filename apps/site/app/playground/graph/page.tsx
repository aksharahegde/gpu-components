import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { GraphDemo } from '../../../src/components/demos/GraphDemo'

export const metadata: Metadata = {
  title: 'GPUGraph — gpu-components',
  description: 'The only component here that animates. Positions are computed on the GPU, fed back into themselves through a ping-pong buffer pair, and never read back.',
}

export default function GPUGraphPage() {
  return (
    <>
      <PageHead eyebrow="GPUGraph" title="Force-directed graph" lead={'Drag to pan and scroll to zoom while the layout settles in front of you. Hover is deliberately not wired up here — the node positions never leave the GPU, so there is nothing on the CPU to test against.'} />
      <Section>
        <GraphDemo />
      </Section>
    </>
  )
}
