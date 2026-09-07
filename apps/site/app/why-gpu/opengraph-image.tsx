import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '../../src/og'

export const dynamic = 'force-static'
export const alt = 'Why GPU — gpu-components'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgCard({
    eyebrow: 'Why GPU',
    title: 'Do not use the GPU merely because it is possible.',
    lead: 'Every component in this library has to clear a six-question gate. Components that fail it are rejected — including ones that would look impressive in a screenshot.',
  })
}
