import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { WhiteboardDemo } from '../../../src/components/demos/WhiteboardDemo'

export const metadata: Metadata = {
  title: 'GPUWhiteboard — gpu-components',
  description:
    'Freeform infinite canvas: a procedural dot-grid background, instanced shapes, and ink, with draw tools, multi-select, move, and delete over exact CPU hit-testing.',
}

export default function GPUWhiteboardPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUWhiteboard"
        title="Whiteboard"
        lead={
          'Pan and zoom over a board with no geometry behind it — the dot grid is generated in the fragment shader. Draw six shape kinds, select and move them (shift-click, marquee), and delete.'
        }
      />
      <Section>
        <WhiteboardDemo />
      </Section>
    </>
  )
}
