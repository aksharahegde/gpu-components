import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '../../src/og'

export const dynamic = 'force-static'
export const alt = 'Playground — gpu-components'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgCard({
    eyebrow: 'Playground',
    title: 'Check the claim yourself',
    lead: 'Seventeen GPU components, one page each — live demos running in your browser on your GPU.',
  })
}
