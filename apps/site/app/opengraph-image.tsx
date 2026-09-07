import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '../src/og'

export const dynamic = 'force-static'
export const alt = 'gpu-components — GPU components that share one device'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgCard({
    eyebrow: 'WebGPU runtime',
    title: 'GPU components that share one device',
    lead: 'A framework-independent WebGPU runtime for application components, built on vgpu. One device, one frame, one submit, across every component on the page.',
  })
}
