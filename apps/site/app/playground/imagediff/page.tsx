import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { ImageDiffDemo } from '../../../src/components/demos/ImageDiffDemo'

const DESCRIPTION =
  'Two images, compared pixel by pixel on the GPU. The component that finally uses real textures — and the one that filled a hole in this project’s own contract.'
const LEAD =
  'Try each mode — split, onion-skin, difference, heat — then drag the slider that mode exposes. Turn off smooth sampling to see nearest-neighbour texture filtering at the pixel level.'

export const metadata: Metadata = {
  title: 'GPUImageDiff — gpu-components',
  description: DESCRIPTION,
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
