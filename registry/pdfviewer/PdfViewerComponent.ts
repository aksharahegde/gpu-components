import { createImageTexture, pixelXToTime, pixelYToTrack, viewportUniforms } from "@gpuc/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  ImageTexture,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpuc/core";
import { draw, sampler, uniforms } from "vgpu";
import type { Draw, Gpu, SharedUniforms } from "vgpu";
import { pageAt, visiblePageRange, type PdfDocumentData } from "./ingest.ts";
import { PAGE_WGSL } from "./page.wgsl.ts";

export interface PdfViewerProps {
  readonly document: PdfDocumentData;
  /** x centers on the widest page (`ingestPdfDocument` lays every page out around `x = 0`); y is
   * the vertical scroll position through the document, continuous like `GPUScatter`'s y axis. */
  readonly viewport: ViewportState;
  readonly smooth?: boolean;
}

interface RectUniforms extends Record<string, unknown> {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Resident texture pool size — generous relative to how many pages a viewport typically shows at
 * once (1-3 full pages plus slivers of their neighbours), so scrolling a little doesn't thrash
 * textures in and out. Page *count* in a document barely matters (`MAX_PAGES` is 10,000): only
 * pages within `PRELOAD_MARGIN` of the viewport ever get a texture, the same "the dataset can be
 * unbounded, the resident set can't" shape `GPULogViewer`'s `RingBuffer` and `GPUDataGrid`'s row
 * virtualization already use.
 */
const POOL_SIZE = 8;
/** Extra document-space margin, as a fraction of the visible height, kept resident past each edge
 * of the viewport — enough that a page textures in just before it scrolls into view, not the frame
 * it arrives. */
const PRELOAD_MARGIN_FRACTION = 0.5;

interface Slot {
  pageIndex: number | null;
  texture: ImageTexture;
  draw: Draw;
  rectUniform: SharedUniforms<RectUniforms>;
}

function placeholderBitmap(): { readonly data: Uint8Array<ArrayBuffer>; readonly width: number; readonly height: number } {
  return { data: new Uint8Array(new ArrayBuffer(4)), width: 1, height: 1 };
}

let nextId = 0;

/**
 * `GPUPdfViewer` — a virtualized, zoomable multi-page document compositor (PLAN.md #15).
 *
 * Deliberately not a PDF renderer — see `ingest.ts`'s header comment for why rasterization is the
 * host's job, via `pdf.js` or anything else. What this component owns is the part a GPU actually
 * helps with: a small pool of resident page textures (`POOL_SIZE`), reassigned as the viewport
 * scrolls, each drawn as one positioned textured quad (`page.wgsl.ts`) rather than through
 * `InstancedQuadLayer` — a page's defining property is that it needs its own texture binding, which
 * an instanced draw's one-shader-many-instances shape can't express.
 *
 * No compute passes, no `animating`: nothing here moves without the viewport changing, which is
 * always a host-driven prop update, not something this component generates on its own.
 */
export class PdfViewerComponent implements GpuComponent<PdfViewerProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private warnings: ComponentContext["runtime"]["warnings"] | null = null;

  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private slots: Slot[] = [];
  private smooth = false;

  private uploadedDocument: PdfDocumentData | null = null;
  private currentViewport: ViewportState | null = null;

  constructor() {
    this.id = `pdfviewer-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;
    this.warnings = ctx.runtime.warnings;

    this.viewportUniform = uniforms(ctx.gpu!, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });

    const placeholder = placeholderBitmap();
    this.slots = Array.from({ length: POOL_SIZE }, (_, i) => {
      const rectUniform = uniforms(ctx.gpu!, { x: 0, y: 0, w: 0, h: 0 });
      const drawable = draw(ctx.gpu!, { shader: PAGE_WGSL, vertices: 6, label: `${this.id}-page-${i}` });
      const texture = createImageTexture(ctx.gpu!, placeholder, this.caps, { label: `${this.id}-tex-${i}` });
      drawable.set({
        viewport: this.viewportUniform,
        rect: rectUniform,
        pageTexture: texture.view,
        pageSampler: this.samplerFor(this.smooth),
      });
      return { pageIndex: null, texture, draw: drawable, rectUniform };
    });

    if (this.uploadedDocument) this.assignSlots(this.uploadedDocument, this.visibleRangeFor(this.currentViewport));
    if (this.currentViewport) this.viewportUniform.set(viewportUniforms(this.currentViewport));
  }

  private samplerFor(smooth: boolean): unknown {
    if (!this.gpu) return undefined;
    const filter: GPUFilterMode = smooth ? "linear" : "nearest";
    return sampler(this.gpu, { magFilter: filter, minFilter: filter });
  }

  private visibleRangeFor(viewport: ViewportState | null): readonly [number, number] {
    const doc = this.uploadedDocument;
    if (!viewport || !doc || doc.pages.length === 0) return [0, -1];
    const rowStart = viewport.rowStart ?? 0;
    const rowEnd = viewport.rowEnd ?? viewport.trackCount;
    const margin = Math.max(1, (rowEnd - rowStart) * PRELOAD_MARGIN_FRACTION);
    return visiblePageRange(doc, rowStart - margin, rowEnd + margin);
  }

  /** Reconciles the resident texture pool against `[first, last]`: frees slots showing a page that
   * fell out of range, then assigns freed (or already-free) slots to newly-needed pages. Pages
   * beyond `POOL_SIZE` at once are silently capped — not expected in practice at any sane zoom
   * level, since `PRELOAD_MARGIN_FRACTION` bounds the range to roughly 2x the viewport height. */
  private assignSlots(doc: PdfDocumentData, [first, last]: readonly [number, number]): void {
    if (!this.gpu) return;
    const needed = new Set<number>();
    for (let i = first; i <= last; i++) needed.add(i);

    for (const slot of this.slots) {
      if (slot.pageIndex !== null && !needed.has(slot.pageIndex)) slot.pageIndex = null;
    }
    for (const slot of this.slots) {
      if (slot.pageIndex !== null) needed.delete(slot.pageIndex);
    }

    const stillNeeded = [...needed];
    if (stillNeeded.length > 0) {
      const freeSlots = this.slots.filter((s) => s.pageIndex === null);
      if (stillNeeded.length > freeSlots.length) {
        this.warnings?.report({
          code: "pdfviewer-pool-exhausted",
          source: this.id,
          message:
            `${stillNeeded.length} pages need a texture but only ${freeSlots.length} pool slots are free ` +
            `(POOL_SIZE=${POOL_SIZE}) — some visible pages will not render this frame`,
        });
      }
      for (let i = 0; i < Math.min(stillNeeded.length, freeSlots.length); i++) {
        const pageIndex = stillNeeded[i]!;
        const slot = freeSlots[i]!;
        const page = doc.pages[pageIndex]!;
        slot.pageIndex = pageIndex;
        slot.texture.destroy();
        slot.texture = createImageTexture(this.gpu, page.bitmap, this.caps, { label: `${this.id}-tex` });
        slot.draw.set({ pageTexture: slot.texture.view });
        slot.rectUniform.set({ x: -page.width / 2, y: doc.pageOffsetY[pageIndex]!, w: page.width, h: page.height });
      }
    }
  }

  update(props: PdfViewerProps): void {
    const smooth = props.smooth ?? false;
    if (smooth !== this.smooth) {
      this.smooth = smooth;
      const s = this.samplerFor(smooth);
      for (const slot of this.slots) slot.draw.set({ pageSampler: s });
    }

    const documentChanged = props.document !== this.uploadedDocument;
    this.uploadedDocument = props.document;
    this.currentViewport = props.viewport;
    this.viewportUniform?.set(viewportUniforms(props.viewport));

    // A document swap invalidates every resident page, even ones whose index happens to still be
    // in range — the bitmap behind that index is a different page now.
    if (documentChanged) {
      for (const slot of this.slots) slot.pageIndex = null;
    }
    this.assignSlots(props.document, this.visibleRangeFor(props.viewport));

    this.dirty = true;
  }

  /** Returns the 1-based page number under `(x, y)`, or `null` outside every page's document-space
   * rectangle (e.g. in the gap between pages). CPU, from `pageOffsetY` — same reasoning as every
   * other component here that declines GPU picking (PLAN.md §9.5): scroll position changes only on
   * an explicit user action, never every frame on its own. */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    const doc = this.uploadedDocument;
    if (!viewport || !doc || doc.pages.length === 0) return null;
    const domainX = pixelXToTime(viewport, x);
    const domainY = pixelYToTrack(viewport, y);
    const index = pageAt(doc, domainY);
    const page = doc.pages[index]!;
    const top = doc.pageOffsetY[index]!;
    if (domainY < top || domainY > top + page.height) return null; // inside the gap after this page
    if (domainX < -page.width / 2 || domainX > page.width / 2) return null;
    return { id: page.pageNumber };
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.currentViewport || !this.uploadedDocument) return { computePasses: [], renderPasses: [] };
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "pdfviewer",
          target: "surface",
          clear: true,
          encode: (pass) => {
            if (pass.kind === "canvas2d") {
              pass.report(`${this.id}: no Canvas2D fallback — pages are GPU textures only`);
              return;
            }
            for (const slot of this.slots) {
              if (slot.pageIndex !== null) pass.frame.draw(slot.draw);
            }
          },
        },
      ],
    };
  }

  dispose(): void {
    for (const slot of this.slots) slot.texture.destroy();
    this.slots = [];
  }
}
