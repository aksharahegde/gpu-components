import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '../../src/og'

export const dynamic = 'force-static'
export const alt = 'Components — gpu-components'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgCard({
    eyebrow: 'Components',
    title: 'Eighteen candidates, scored, and one chosen.',
    lead: 'Weights encode this project’s priorities: we are building a runtime first, so reusable primitives and GPU necessity outrank raw market size.',
  })
}
