import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { CandlestickDemo } from '../../../src/components/demos/CandlestickDemo'

const LEAD =
  'Two hundred thousand OHLC bars in a GPU ring, revised tick by tick. Built to test a primitive rather than to add a chart — and it found the gap it went looking for.'

export const metadata: Metadata = {
  title: 'GPUCandlestick — gpu-components',
  description: LEAD,
}

export default function GPUCandlestickPage() {
  return (
    <>
      <PageHead eyebrow="GPUCandlestick" title="Candlestick chart" lead={LEAD} />
      <Section>
        <CandlestickDemo />
      </Section>
    </>
  )
}
