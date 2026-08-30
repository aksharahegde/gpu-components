import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { TimelineDemo } from '../../../src/components/demos/TimelineDemo'

export const metadata: Metadata = {
  title: 'GPUTimeline — gpu-components',
  description: 'A trace, span and event timeline: instanced spans, LOD density binning, brush selection, and a DOM label layer that doubles as the accessibility tree.',
}

export default function GPUTimelinePage() {
  return (
    <>
      <PageHead eyebrow="GPUTimeline" title="Trace timeline" lead={'A trace, span and event timeline: instanced spans, LOD density binning, brush selection, and a DOM label layer that doubles as the accessibility tree.'} />
      <Section>
        <TimelineDemo />
      </Section>
    </>
  )
}
