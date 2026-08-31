import type { Metadata } from 'next'
import { PageHead, Section } from '../../../src/ui'
import { AnnotationCanvasDemo } from '../../../src/components/demos/AnnotationCanvasDemo'

export const metadata: Metadata = {
  title: 'GPUAnnotationCanvas — gpu-components',
  description:
    'A Float32 field with a GPU colormap, min/max window and a host-owned annotation overlay — rectangles, ellipses, points, rulers, polygons and freehand, with GPU-measured length/area labels.',
}

export default function GPUAnnotationCanvasPage() {
  return (
    <>
      <PageHead
        eyebrow="GPUAnnotationCanvas"
        title="Annotate a scalar field"
        lead={
          'A Float32 field with a GPU colormap, min/max window and a host-owned annotation overlay — rectangles, ellipses, points, rulers, polygons and freehand, with measured length/area labels.'
        }
      />
      <Section>
        <AnnotationCanvasDemo />
      </Section>
    </>
  )
}
