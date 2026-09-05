import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { GridDemo } from '../../../src/components/demos/GridDemo'

export const metadata: Metadata = {
  title: 'GPUDataGrid — gpu-components',
  description: 'The flagship, built last on purpose. GPU cell chrome and per-cell conditional formatting; text on a Canvas2D layer, because measurement said a glyph atlas was not needed.',
}

export default function GPUDataGridPage() {
  return (
    <>
      <PageHead eyebrow="GPUDataGrid" title="Data grid" lead={'Scroll to move through the 5,000 rows, hold shift and scroll to move across columns, and click a row to select it. Watch the per-cell tint: colour is computed per cell in the fragment shader from where each value sits in its column’s range.'} />
      <Section>
        <GridDemo />
      </Section>
    </>
  )
}
