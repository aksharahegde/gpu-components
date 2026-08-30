import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { LogViewerDemo } from '../../../src/components/demos/LogViewerDemo'

const LEAD =
  'Half a million log lines resident on the GPU, appended a batch at a time. The first component here whose dataset has a tail — and the one that proved this project does not need a glyph atlas.'

export const metadata: Metadata = {
  title: 'GPULogViewer — gpu-components',
  description: LEAD,
}

export default function GPULogViewerPage() {
  return (
    <>
      <PageHead eyebrow="GPULogViewer" title="Log viewer" lead={LEAD} />
      <Section>
        <LogViewerDemo />
      </Section>
    </>
  )
}
