import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '../../src/og'

export const dynamic = 'force-static'
export const alt = 'Architecture — gpu-components'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgCard({
    eyebrow: 'Architecture',
    title: 'One device, a scheduler, and four primitives.',
    lead: 'The design is deliberately small. Four of the nine subsystems a runtime like this usually grows are already vgpu’s, and building them again would be duplication with a version number on it.',
  })
}
