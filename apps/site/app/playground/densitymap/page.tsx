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
          'Drag to pan and scroll to zoom across Western Europe’s hotspots, then hover a hex cell to see its bin index. Zoom in and the same 250,000 points resolve into finer, still screen-sized hexagons.'
        }
      />
      <Section>
        <DensityMapDemo />
      </Section>
    </>
  )
}
