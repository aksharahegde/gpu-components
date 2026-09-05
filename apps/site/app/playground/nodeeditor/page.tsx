import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { NodeEditorDemo } from '../../../src/components/demos/NodeEditorDemo'

export const metadata: Metadata = {
  title: 'GPUNodeEditor — gpu-components',
  description:
    'Freeform node-flow canvas: drag nodes, drag-to-connect ports, multi-select and delete, all CPU-owned state with GPU-drawn boxes, ports and lines.',
}

export default function GPUNodeEditorPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUNodeEditor"
        title="Node editor"
        lead={
          'Drag a node to move it or drag from a port to wire up a new connection, then shift-click or shift-drag a marquee to select several nodes and delete them at once. Every position and connection lives on the CPU; the GPU only redraws the result.'
        }
      />
      <Section>
        <NodeEditorDemo />
      </Section>
    </>
  )
}
