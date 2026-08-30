import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { HeatmapDemo } from '../../../src/components/demos/HeatmapDemo'

export const metadata: Metadata = {
  title: 'GPUHeatmap — gpu-components',
  description: 'A dense matrix with a GPU colormap and GPU min/max auto-ranging. Built as PLAN.md §29’s architecture test — the component that had to prove the runtime could host something it was not designed around.',
}

export default function GPUHeatmapPage() {
  return (
    <>
      <PageHead eyebrow="GPUHeatmap" title="Matrix heatmap" lead={'A dense matrix with a GPU colormap and GPU min/max auto-ranging. Built as PLAN.md §29’s architecture test — the component that had to prove the runtime could host something it was not designed around.'} />
      <Section>
        <HeatmapDemo />
      </Section>
    </>
  )
}
