import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '../../src/og'

export const dynamic = 'force-static'
export const alt = 'Get started — gpu-components'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgCard({
    eyebrow: 'Get started',
    title: 'The runtime works. The install does not exist yet.',
    lead: 'The intended install surface, written down before it exists so it can be argued with while changing it is still cheap. The runtime and seventeen components run in the playground today.',
  })
}
