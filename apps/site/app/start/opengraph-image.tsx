import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '../../src/og'

export const dynamic = 'force-static'
export const alt = 'Get started — gpu-components'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgCard({
    eyebrow: 'Get started',
    title: 'The runtime works. So does the install.',
    lead: 'The runtime and seventeen components run in the playground today, and every command on this page is live on npm right now.',
  })
}
