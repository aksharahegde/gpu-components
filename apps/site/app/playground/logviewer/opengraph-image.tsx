import { OG_CONTENT_TYPE, OG_SIZE, componentOg } from '../../../src/og'

const og = componentOg('logviewer')

export const dynamic = 'force-static'
export const alt = og.alt
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default og.image
