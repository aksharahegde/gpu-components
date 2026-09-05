import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { CandlestickDemo } from '../../../src/components/demos/CandlestickDemo'

const DESCRIPTION =
  'Two hundred thousand OHLC bars in a GPU ring, revised tick by tick. Built to test a primitive rather than to add a chart — and it found the gap it went looking for.'
const LEAD =
  'Start ticks to watch the newest bar revise in place, drag the bar-width slider, and hover any bar to read its OHLC values. The strip along the bottom is a whole-history min/max/volume envelope, not just what is on screen.'

export const metadata: Metadata = {
  title: 'GPUCandlestick — gpu-components',
  description: DESCRIPTION,
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
