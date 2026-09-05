import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { HistogramDemo } from '../../../src/components/demos/HistogramDemo'

export const metadata: Metadata = {
  title: 'GPUHistogram — gpu-components',
  description:
    'Adaptive 1D histogram: Freedman–Diaconis bins at ingest, GPU atomic binning, instanced bars.',
}

export default function GPUHistogramPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUHistogram"
        title="Histogram"
        lead={
          'Scroll to zoom the value axis and drag to pan, then hover a bar to inspect one adaptively-sized bin. The bin edges came from Freedman–Diaconis once at ingest — panning and zooming never touch the underlying values.'
        }
      />
      <Section>
        <HistogramDemo />
      </Section>
    </>
  )
}
