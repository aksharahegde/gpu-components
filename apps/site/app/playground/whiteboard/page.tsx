import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { WhiteboardDemo } from '../../../src/components/demos/WhiteboardDemo'

export const metadata: Metadata = {
  title: 'GPUWhiteboard — gpu-components',
  description:
    'Freeform infinite canvas: a procedural dot-grid background, instanced shapes, and ink, with exact CPU hit-testing. Phase 1 — pan and zoom only.',
}

export default function GPUWhiteboardPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUWhiteboard"
        title="Whiteboard"
        lead={
          'Freeform infinite canvas: a procedural dot-grid background, instanced shapes, and ink, with exact CPU hit-testing. Phase 1 — pan and zoom only.'
        }
      />
      <Section>
        <WhiteboardDemo />
      </Section>
    </>
  )
}
