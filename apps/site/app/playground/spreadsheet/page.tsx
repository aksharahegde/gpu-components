import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { SpreadsheetDemo } from '../../../src/components/demos/SpreadsheetDemo'

export const metadata: Metadata = {
  title: 'GPUSpreadsheet — gpu-components',
  description: 'Editable, formula-driven. GPU cell chrome and selection; a CPU dependency-graph formula engine and cell editing — formulas never touch the GPU.',
}

export default function GPUSpreadsheetPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUSpreadsheet"
        title="Spreadsheet"
        lead="Editable, formula-driven. GPU cell chrome, selection, and a dirty-cell flash; a CPU dependency-graph formula engine, cell editing, and clipboard — formulas never touch the GPU."
      />
      <Section>
        <SpreadsheetDemo />
      </Section>
    </>
  )
}
