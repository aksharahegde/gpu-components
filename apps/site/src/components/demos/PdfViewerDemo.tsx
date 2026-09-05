'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUPdfViewer, ingestPdfDocument, type PdfPage } from '../../../../../registry/pdfviewer'
import { fmtInt, s, useMeasuredStage } from './chrome'

const PAGE_COUNT = 24
const PAGE_W = 320
const PAGE_H = 414

/**
 * Synthesizes placeholder page bitmaps with plain Canvas2D — standing in for `pdf.js` (or any other
 * renderer), which is deliberately not a dependency of this component or this demo. See
 * `registry/pdfviewer/ingest.ts`'s header comment for why rasterization is the host's job.
 */
function renderMockPage(pageNumber: number): PdfPage {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W
  canvas.height = PAGE_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f4f2ec'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  ctx.strokeStyle = '#d8d4c8'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, PAGE_W - 1, PAGE_H - 1)

  ctx.fillStyle = '#1a1a1a'
  ctx.font = 'bold 22px ui-monospace, monospace'
  ctx.fillText(`Section ${pageNumber}`, 28, 48)

  ctx.fillStyle = '#555'
  ctx.font = '12px ui-monospace, monospace'
  const lineHeight = 20
  const lines = 14
  for (let i = 0; i < lines; i++) {
    const width = 40 + Math.round(Math.sin(pageNumber + i) * 60 + 180)
    ctx.fillRect(28, 80 + i * lineHeight, width, 8)
  }

  ctx.fillStyle = '#8a8a8a'
  ctx.font = '11px ui-monospace, monospace'
  ctx.fillText(String(pageNumber), PAGE_W / 2 - 6, PAGE_H - 20)

  const data = ctx.getImageData(0, 0, PAGE_W, PAGE_H).data;
  return {
    pageNumber,
    width: PAGE_W,
    height: PAGE_H,
    bitmap: { data: new Uint8Array(data.buffer.slice(0)) as Uint8Array<ArrayBuffer>, width: PAGE_W, height: PAGE_H },
  }
}

function buildDocument() {
  const pages = Array.from({ length: PAGE_COUNT }, (_, i) => renderMockPage(i + 1))
  return ingestPdfDocument(pages, { pageGap: 24 })
}

function PdfViewerStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 960, height: 560 })

  const doc = useMemo(() => buildDocument(), [])
  const [currentPage, setCurrentPage] = useState(1)

  // Fit the widest page's width to the stage, then keep the y axis at the same units-per-pixel
  // scale (not stretched to fill the stage height) so a page renders with its true aspect ratio.
  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: -doc.maxWidth / 2,
    timeEnd: doc.maxWidth / 2,
    trackCount: 1,
    rowStart: 0,
    rowEnd: (box.height * doc.maxWidth) / Math.max(box.width, 1) || 600,
    yContinuous: true,
    width: box.width,
    height: box.height,
  }))

  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>
          GPUPdfViewer — {fmtInt(doc.pages.length)} pages
        </span>
        <span {...stylex.props(s.readoutValue)}>
          Page {currentPage} of {doc.pages.length}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUPdfViewer
            document={doc}
            viewport={viewport}
            onViewportChange={setViewport}
            onCurrentPageChange={setCurrentPage}
            aria-label="Document"
          />
        )}
      </div>
      <p {...stylex.props(s.footnote)}>
        Pages are plain Canvas2D mockups standing in for pdf.js — this component composites
        already-rasterized bitmaps, it does not parse or render PDFs itself. Only a handful of
        pages near the viewport ever hold a real GPU texture; scroll far enough and watch earlier
        ones get evicted from the resident pool.
      </p>
    </div>
  )
}

const PROVIDER_OPTIONS = { profiling: true }

export function PdfViewerDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <PdfViewerStage />
    </GPUProvider>
  )
}
