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
      <PageHead eyebrow="GPUTimeline" title="Trace timeline" lead={'Drag to pan, scroll to zoom, drag across the surface to brush-select. Zoom far enough out and the renderer switches to a binned density field without telling you.'} />
      <Section>
        <TimelineDemo />
      </Section>
    </>
  )
}
