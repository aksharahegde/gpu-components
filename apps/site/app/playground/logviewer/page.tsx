import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { LogViewerDemo } from '../../../src/components/demos/LogViewerDemo'

const DESCRIPTION =
  'Half a million log lines resident on the GPU, appended a batch at a time. The first component here whose dataset has a tail — and the one that proved this project does not need a glyph atlas.'
const LEAD =
  'Type a search term to filter half a million lines live, then hit Start stream to watch new lines append while the density strip on the right updates. Scroll up to break out of Follow mode.'

export const metadata: Metadata = {
  title: 'GPULogViewer — gpu-components',
  description: DESCRIPTION,
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
