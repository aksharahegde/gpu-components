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
      <PageHead eyebrow="GPUDataGrid" title="Data grid" lead={'The flagship, built last on purpose. GPU cell chrome and per-cell conditional formatting; text on a Canvas2D layer, because measurement said a glyph atlas was not needed.'} />
      <Section>
        <GridDemo />
      </Section>
    </>
  )
}
