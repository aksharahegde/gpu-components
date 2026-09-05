import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { PdfViewerDemo } from '../../../src/components/demos/PdfViewerDemo'

export const metadata: Metadata = {
  title: 'GPUPdfViewer — gpu-components',
  description:
    'Virtualized multi-page document compositor: a small resident-texture pool, continuous zoom/scroll, and CPU page hit-testing over host-rasterized page bitmaps. Not a PDF renderer.',
}

export default function GPUPdfViewerPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUPdfViewer"
        title="Document viewer"
        lead={
          'Scroll through the 24 pages and watch the page counter track your position, then keep scrolling to see earlier pages evicted from the small resident-texture pool as new ones load in.'
        }
      />
      <Section>
        <PdfViewerDemo />
      </Section>
    </>
  )
}
