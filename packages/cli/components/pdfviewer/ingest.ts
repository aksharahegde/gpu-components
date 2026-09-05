/**
 * `GPUPdfViewer`'s data model (PLAN.md #15, "GPU PDF / document viewer").
 *
 * Deliberately **not** a PDF parser. Parsing a PDF and rasterizing a page to pixels is not a GPU
 * problem — it's what `pdf.js` (or any other renderer) does, and there is no WGSL path to "parse a
 * PDF". This component receives already-rasterized pages, the same boundary `GPUHeatmap` draws
 * around `FieldData` (a windowed array, not the raw source that produced it) and `GPUAnnotationCanvas`
 * draws around its field. What a GPU legitimately helps with, once rasterization is someone else's
 * job, is compositing: virtualized multi-page scroll, continuous zoom, and page-texture recycling —
 * see `PdfViewerComponent`'s doc comment for how that's structured.
 */

export interface PageBitmap {
  /** Tightly packed RGBA8, `width * height * 4` bytes — the same shape `createImageTexture` (from
   * `GPUImageDiff`) already expects, since that's exactly what uploads it. */
  readonly data: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

export interface PdfPage {
  /** 1-based, matching how documents and viewers everywhere number pages — never used as an array
   * index (use the page's position in `PdfDocumentData.pages` for that). */
  readonly pageNumber: number;
  /** Page size in document units. Independent of `bitmap`'s pixel dimensions — a page can be
   * rasterized at any DPI; document-space layout doesn't change when the host re-rasterizes at a
   * higher resolution for a closer zoom. */
  readonly width: number;
  readonly height: number;
  readonly bitmap: PageBitmap;
}

export interface PdfDocumentData {
  readonly pages: readonly PdfPage[];
  /** Gap between pages, in document units. */
  readonly pageGap: number;
  /** Cumulative top-edge y offset of each page, index-aligned with `pages`. */
  readonly pageOffsetY: Float64Array;
  readonly totalHeight: number;
  readonly maxWidth: number;
}

/** Device-texture-shaped ceiling, matching `GPUImageDiff`'s own page bitmap limit. */
export const MAX_PAGE_DIM = 8192;
/** A soft, not architectural, cap — see `PdfViewerComponent`'s resident-texture pool for why page
 * *count* barely matters (only pages near the viewport ever get a texture) while page count still
 * bounds CPU-side layout and hit-testing work. */
export const MAX_PAGES = 10_000;

const DEFAULT_PAGE_GAP = 24;

export interface IngestPdfDocumentOptions {
  readonly pageGap?: number;
}

/**
 * Validates page bitmaps and lays every page out in one vertical, centered column — the
 * conventional "continuous scroll" document layout every PDF viewer uses. Horizontal position is
 * derived (`-width / 2`), so a viewport centered on `x = 0` always centers the widest page.
 */
export function ingestPdfDocument(
  pages: readonly PdfPage[],
  options: IngestPdfDocumentOptions = {},
): PdfDocumentData {
  const pageGap = options.pageGap ?? DEFAULT_PAGE_GAP;
  if (pages.length === 0) {
    throw new RangeError("gpu-components/pdfviewer: at least one page is required");
  }
  if (pages.length > MAX_PAGES) {
    throw new RangeError(`gpu-components/pdfviewer: at most ${MAX_PAGES} pages, got ${pages.length}`);
  }

  const pageOffsetY = new Float64Array(pages.length);
  let cursor = 0;
  let maxWidth = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) {
      throw new RangeError(`gpu-components/pdfviewer: page ${page.pageNumber} has an invalid size`);
    }
    const { data, width: bw, height: bh } = page.bitmap;
    if (!Number.isInteger(bw) || !Number.isInteger(bh) || bw <= 0 || bh <= 0) {
      throw new RangeError(`gpu-components/pdfviewer: page ${page.pageNumber} has an invalid bitmap size`);
    }
    if (bw > MAX_PAGE_DIM || bh > MAX_PAGE_DIM) {
      throw new RangeError(`gpu-components/pdfviewer: page ${page.pageNumber} exceeds ${MAX_PAGE_DIM}px MAX_PAGE_DIM`);
    }
    const expected = bw * bh * 4;
    if (data.length !== expected) {
      throw new RangeError(
        `gpu-components/pdfviewer: page ${page.pageNumber} bitmap expected ${expected} bytes, got ${data.length}`,
      );
    }

    pageOffsetY[i] = cursor;
    cursor += page.height + pageGap;
    maxWidth = Math.max(maxWidth, page.width);
  }

  return {
    pages,
    pageGap,
    pageOffsetY,
    totalHeight: Math.max(0, cursor - pageGap),
    maxWidth,
  };
}

/** Binary search over `pageOffsetY` for the page containing document-space `y`, or the nearest one
 * past the end. Used both for hit-testing and for computing which pages are visible. */
export function pageAt(doc: PdfDocumentData, y: number): number {
  const { pageOffsetY, pages } = doc;
  let lo = 0;
  let hi = pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pageOffsetY[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Every page index whose rectangle intersects `[yMin, yMax]`, document-space. */
export function visiblePageRange(doc: PdfDocumentData, yMin: number, yMax: number): readonly [number, number] {
  if (doc.pages.length === 0) return [0, -1];
  const first = Math.max(0, pageAt(doc, yMin));
  let last = pageAt(doc, yMax);
  // `pageAt` clamps to the last page when `y` is past the end of its own rectangle, so grow `last`
  // forward while the *next* page's top edge is still within range (a tall viewport can span many
  // short pages, and `pageAt(yMax)` alone would only find whichever page contains that one point).
  while (last + 1 < doc.pages.length && doc.pageOffsetY[last + 1]! <= yMax) last++;
  return [first, last];
}
