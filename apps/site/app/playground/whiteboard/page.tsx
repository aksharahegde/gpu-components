import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { WhiteboardDemo } from '../../../src/components/demos/WhiteboardDemo'

export const metadata: Metadata = {
  title: 'GPUWhiteboard — gpu-components',
  description:
    'Freeform infinite canvas: a procedural dot-grid background, instanced shapes, and ink, with exact CPU hit-testing. Pan and zoom today; drawing tools are next.',
}

export default function GPUWhiteboardPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUWhiteboard"
        title="Whiteboard"
        lead={
          'Pan and zoom over a board with no geometry behind it — the dot grid is generated in the fragment shader, so there is nothing to redraw when you move.'
        }
      />
      <Section>
        <WhiteboardDemo />
      </Section>
    </>
  )
}
