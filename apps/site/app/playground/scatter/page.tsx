import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { ScatterDemo } from '../../../src/components/demos/ScatterDemo'

export const metadata: Metadata = {
  title: 'GPUScatter — gpu-components',
  description: 'A quarter of a million points in one instanced draw call. The clearest demonstration this project can make, and the component that disproved a claim in its own plan.',
}

export default function GPUScatterPage() {
  return (
    <>
      <PageHead eyebrow="GPUScatter" title="Scatter plot" lead={'Zoom with the wheel at the cursor, then drag to brush-select a region — both are cheap because the CPU never touches the point buffer. Hover any point for a same-frame, no-picking-pass lookup.'} />
      <Section>
        <ScatterDemo />
      </Section>
    </>
  )
}
