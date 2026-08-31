import { createPointerController, createViewportController, normalizeWheel } from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { ImageDiffComponent, type DiffStats } from "./ImageDiffComponent.ts";
import type { DiffMode, ImagePair } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;

export interface GPUImageDiffProps {
  readonly pair: ImagePair;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly mode?: DiffMode;
  readonly split?: number;
  readonly blend?: number;
  readonly amplify?: number;
  readonly threshold?: number;
  readonly smooth?: boolean;
  /** The changed-pixel count, once the stats pass has run for the current pair. */
  readonly onStats?: (stats: DiffStats) => void;
  /** The image pixel under the cursor, or null when the pointer leaves the image. */
  readonly onHover?: (pixel: { x: number; y: number } | null) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/**
 * `GPUImageDiff` — two images compared on the GPU.
 *
 * Hover is exact and synchronous, like the grid's and unlike the graph's: an image is a regular
 * lattice, so the pixel under the cursor is arithmetic on the viewport, and no picking pass is
 * needed. What this wrapper adds over the others is the **stats readback** — an async `read()` run
 * once per image pair rather than per frame, which is what makes it a diagnostic within PLAN.md
 * §5's rules rather than a stall in the frame loop.
 *
 * The accessible summary carries the number that actually matters to someone reviewing a visual
 * regression: what percentage of the image changed. That is a fact a screen-reader user cannot
 * obtain from the picture by any other means, which is precisely §21's test for what belongs there.
 */
export function GPUImageDiff(props: GPUImageDiffProps): JSX.Element {
  const { pair, onViewportChange, onStats, onHover, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const [stats, setStats] = useState<DiffStats | null>(null);

  const bounds: ViewportBounds = useMemo(
    () => ({ timeMin: 0, timeMax: pair.width, rowMin: 0, rowMax: pair.height }),
    [pair.width, pair.height],
  );

  const changedPercent = stats ? (stats.changedPixels / Math.max(stats.totalPixels, 1)) * 100 : null;
  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Image comparison",
    summary:
      `${pair.width} by ${pair.height} image comparison. ` +
      (changedPercent === null
        ? "Measuring differences."
        : changedPercent === 0
          ? "The two images are identical."
          : `${changedPercent.toFixed(2)} percent of pixels changed ` +
            `(${stats!.changedPixels.toLocaleString("en-US")} of ${stats!.totalPixels.toLocaleString("en-US")}).`),
  });

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const setViewport = useCallback(
    (next: ViewportState) => {
      if (onViewportChange) onViewportChange(next);
      else setInternalViewport(next);
    },
    [onViewportChange],
  );
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;

  const componentRef = useRef<ImageDiffComponent | null>(null);
  const factory = useCallback(() => {
    const component = new ImageDiffComponent();
    componentRef.current = component;
    return component;
  }, []);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({
        pair,
        viewport,
        mode: props.mode,
        split: props.split,
        blend: props.blend,
        amplify: props.amplify,
        threshold: props.threshold,
        smooth: props.smooth,
      }),
      [pair, viewport, props.mode, props.split, props.blend, props.amplify, props.threshold, props.smooth],
    ),
  );

  // Read the count back once per image pair. Deliberately not per frame: the answer does not depend
  // on the viewport, and an await inside the frame loop is exactly what §5 disqualifies.
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    // One frame's grace so the stats pass has been dispatched before the buffer is read.
    const timer = setTimeout(() => {
      void componentRef.current?.readStats().then((next) => {
        if (cancelled || !next) return;
        setStats(next);
        onStats?.(next);
      });
    }, 32);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pair, props.threshold, onStats]);

  useEffect(() => {
    const el = canvas;
    if (!el) return;
    const pointer = createPointerController();
    const detach = pointer.attach(el);
    let dragFrom: { x: number; y: number } | null = null;

    const unsubDown = pointer.onDown((state) => {
      dragFrom = { x: state.x, y: state.y };
    });
    const unsubMove = pointer.onMove((state) => {
      if (dragFrom && state.dragging) {
        const controller = createViewportController(viewportRef.current, bounds);
        controller.panByPixels(-(state.x - dragFrom.x), -(state.y - dragFrom.y));
        dragFrom = { x: state.x, y: state.y };
        setViewportRef.current(controller.getState());
        return;
      }
      if (!onHover) return;
      const hit = componentRef.current?.hitTest(state.x, state.y);
      const id = hit ? Number(hit.id) : null;
      onHover(id !== null ? { x: id % pair.width, y: Math.floor(id / pair.width) } : null);
    });
    const unsubUp = pointer.onUp(() => {
      dragFrom = null;
    });
    const onLeave = () => onHover?.(null);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaY } = normalizeWheel(e);
      const factor = Math.exp(deltaY * ZOOM_SPEED);
      const controller = createViewportController(viewportRef.current, bounds);
      // Both axes at the cursor, and by the same factor — an image must not shear while zooming.
      controller.zoomAt(e.clientX - rect.left, factor);
      controller.zoomAtY(e.clientY - rect.top, factor);
      setViewportRef.current(controller.getState());
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      unsubDown();
      unsubMove();
      unsubUp();
      detach();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [canvas, bounds, onHover, pair.width]);

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
