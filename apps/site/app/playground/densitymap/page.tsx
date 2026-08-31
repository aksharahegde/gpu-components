import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { DensityMapDemo } from '../../../src/components/demos/DensityMapDemo'

export const metadata: Metadata = {
  title: 'GPUDensityMap — gpu-components',
  description:
    'Lon/lat points hexbinned on the GPU over Web Mercator, with graticule and world-outline chrome — no tile basemap.',
}

export default function GPUDensityMapPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUDensityMap"
        title="Density map"
        lead={
          'Lon/lat points hexbinned on the GPU over Web Mercator, with graticule and world-outline chrome — no tile basemap.'
        }
      />
      <Section>
        <DensityMapDemo />
      </Section>
    </>
  )
}
