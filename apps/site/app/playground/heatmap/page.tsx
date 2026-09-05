import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { HeatmapDemo } from '../../../src/components/demos/HeatmapDemo'

export const metadata: Metadata = {
  title: 'GPUHeatmap — gpu-components',
  description: 'A dense matrix with a GPU colormap and GPU min/max auto-ranging. Built as the architecture test — the component that had to prove the runtime could host something it was not designed around.',
}

export default function GPUHeatmapPage() {
  return (
    <>
      <PageHead eyebrow="GPUHeatmap" title="Matrix heatmap" lead={'Drag to pan both axes, scroll to move through rows, and hold ctrl while scrolling to zoom at the cursor. Hover any cell to read its row, column and value.'} />
      <Section>
        <HeatmapDemo />
      </Section>
    </>
  )
}
