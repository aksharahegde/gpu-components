import type { Metadata } from 'next'
import { Body, PageHead, Section } from '../../src/ui'
import { Playground } from '../../src/components/Playground'

export const metadata: Metadata = {
  title: 'Playground — gpu-components',
  description:
    'Pan, zoom, hover and brush a live GPUTimeline at up to 500,000 spans, with the GPU inspector reporting what each frame costs.',
}

export default function PlaygroundPage() {
  return (
    <>
      <PageHead
        eyebrow="Playground"
        title="Grab the component"
        lead="Everything else on this site argues that the runtime works. This page lets you check. It is the real GPUTimeline, running in your browser, on your GPU."
      />
      <Section>
        <Playground />
      </Section>
      <Section title="What you are looking at">
        <Body>
          One <code>GPUDevice</code>, one surface, one submit per frame. Pan and zoom are a
          64-byte uniform write — the span data is uploaded once and never re-walked, which is why
          dragging at 500,000 spans costs the same as dragging at 1,000. Hover is an exact CPU
          binary search over the per-track index, so it is immediate rather than a frame late. The
          brush highlight is a GPU bitset: one compute dispatch marks a bit per selected span and
          the render shader branches on it, with no separate draw and no JavaScript loop over the
          selection.
        </Body>
        <Body>
          The labels are real DOM text — selectable, copyable, and the same layer the screen reader
          navigates. That is not a shortcut around GPU text; it is the design. Tab into the
          timeline and walk it with the arrow keys to hear what an assistive technology gets.
        </Body>
      </Section>
    </>
  )
}
