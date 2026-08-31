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
          'Adaptive 1D histogram: Freedman–Diaconis bins at ingest, GPU atomic binning, instanced bars.'
        }
      />
      <Section>
        <HistogramDemo />
      </Section>
    </>
  )
}
