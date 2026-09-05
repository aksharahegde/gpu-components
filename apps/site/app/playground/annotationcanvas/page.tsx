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
          'Pick a tool — rectangle, ellipse, point, ruler, polygon, freehand — and drag on the field to draw with it. Slide the window min/max to see the same Float32 field remapped through the colormap live.'
        }
      />
      <Section>
        <AnnotationCanvasDemo />
      </Section>
    </>
  )
}
