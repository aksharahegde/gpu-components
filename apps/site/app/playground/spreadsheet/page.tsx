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
        lead="Double-click a cell to edit it, then try typing =D2+1 into D3 and =D3+1 into D2 — the dependency graph catches the circular reference instead of hanging. Watch cells flash briefly whenever a recalculation touches them."
      />
      <Section>
        <SpreadsheetDemo />
      </Section>
    </>
  )
}
