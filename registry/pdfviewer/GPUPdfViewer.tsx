import { createViewportController, normalizeWheel } from "@gpuc/core";
import type { ViewportBounds, ViewportState } from "@gpuc/core";
import { useGpu, useGpuA11y, useGpuComponent } from "@gpuc/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { PdfViewerComponent } from "./PdfViewerComponent.ts";
import { pageAt, type PdfDocumentData } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;

export interface GPUPdfViewerProps {
  readonly document: PdfDocumentData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly smooth?: boolean;
  /** Fires whenever the page nearest the viewport's vertical center changes — the "page N of M"
   * signal a host would show in its own chrome, 1-based. */
  readonly onCurrentPageChange?: (pageNumber: number) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/**
 * `GPUPdfViewer` — virtualized multi-page document compositor (PLAN.md #15).
 *
 * Phase 1: continuous vertical scroll and zoom over a host-rasterized document (see `ingest.ts`'s
 * header comment for why rasterization is out of scope here), with the resident-texture pool
 * reconciled entirely inside `PdfViewerComponent` — this wrapper only forwards the viewport.
 *
 * `onCurrentPageChange`/`a11y.announce` are read through refs inside the wheel handler rather than
 * named in its dependency array — the lesson this session already paid for three times in
 * `GPUNodeEditor`/`GPUDepGraph`/`GPUScatter`: `useGpuA11y()` returns a new wrapper object every
 * render, and naming it (or an inline consumer callback) in a pointer/wheel effect's deps tears the
 * effect down and reattaches it on any mid-gesture re-render, silently resetting closured state.
 */
export function GPUPdfViewer(props: GPUPdfViewerProps): JSX.Element {
  const { document: doc, onViewportChange, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;

  const bounds: ViewportBounds = useMemo(
    () => ({
      timeMin: -doc.maxWidth / 2,
      timeMax: doc.maxWidth / 2,
      rowMin: 0,
      rowMax: doc.totalHeight,
    }),
    [doc.maxWidth, doc.totalHeight],
  );

  const currentPageRef = useRef<number | null>(null);
  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Document",
    summary: `${doc.pages.length.toLocaleString("en-US")} pages.`,
  });
  const announceRef = useRef(a11y.announce);
  announceRef.current = a11y.announce;
  const onCurrentPageChangeRef = useRef(props.onCurrentPageChange);
  onCurrentPageChangeRef.current = props.onCurrentPageChange;

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const setViewport = useCallback(
    (next: ViewportState) => {
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    },
    [onViewportChange],
  );
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;

  const componentRef = useRef<PdfViewerComponent | null>(null);
  const factory = useCallback(() => {
    const component = new PdfViewerComponent();
    componentRef.current = component;
    return component;
  }, []);

  useGpuComponent(
    factory,
    canvas,
    useMemo(() => ({ document: doc, viewport, smooth: props.smooth }), [doc, viewport, props.smooth]),
  );

  const reportCurrentPage = useCallback(
    (v: ViewportState) => {
      if (doc.pages.length === 0) return;
      const rowStart = v.rowStart ?? 0;
      const rowEnd = v.rowEnd ?? v.trackCount;
      const index = pageAt(doc, (rowStart + rowEnd) / 2);
      const pageNumber = doc.pages[index]!.pageNumber;
      if (pageNumber !== currentPageRef.current) {
        currentPageRef.current = pageNumber;
        onCurrentPageChangeRef.current?.(pageNumber);
        announceRef.current(`Page ${pageNumber} of ${doc.pages.length}`);
      }
    },
    [doc],
  );

  useEffect(() => {
    const el = canvas;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaX, deltaY } = normalizeWheel(e);
      const controller = createViewportController(viewportRef.current, boundsRef.current);
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(deltaY * ZOOM_SPEED);
        controller.zoomAt(e.clientX - rect.left, factor);
        controller.zoomAtY(e.clientY - rect.top, factor);
      } else {
        // A natural wheel scroll, not a drag-follows-pointer gesture: positive deltaY (scroll down)
        // should move forward through the document without negation — same convention
        // `GPUSpreadsheet`'s row-wheel handler uses, unlike the drag handlers elsewhere in the
        // registry that negate pointer delta to make content follow the cursor.
        controller.panByPixels(deltaX, deltaY);
      }
      const next = controller.getState();
      setViewportRef.current(next);
      reportCurrentPage(next);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [canvas, reportCurrentPage]);

  // Report the initial page once mounted, and whenever a host-driven viewport change moves it
  // (e.g. a "jump to page" control outside this component).
  useEffect(() => {
    reportCurrentPage(viewport);
  }, [viewport, reportCurrentPage]);

  return (
    <div
      {...a11y.rootProps}
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        aria-hidden="true"
        ref={setCanvas}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      {status === "unsupported" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
          WebGPU unavailable.
        </div>
      )}
      {a11y.regions()}
    </div>
  );
}
