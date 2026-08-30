import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { ImageDiffDemo } from '../../../src/components/demos/ImageDiffDemo'

const LEAD =
  'Two images, compared pixel by pixel on the GPU. The component that finally uses real textures — and the one that filled a hole in this project’s own contract.'

export const metadata: Metadata = {
  title: 'GPUImageDiff — gpu-components',
  description: LEAD,
}

export default function GPUImageDiffPage() {
  return (
    <>
      <PageHead eyebrow="GPUImageDiff" title="Image comparison" lead={LEAD} />
      <Section>
        <ImageDiffDemo />
      </Section>
    </>
  )
}
