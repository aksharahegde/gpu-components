import { createPointerController, createViewportController, normalizeWheel } from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { HistogramComponent } from "./HistogramComponent.ts";
import type { HistogramData } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;

export interface GPUHistogramProps {
  readonly data: HistogramData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly binCount?: number;
  readonly hoveredBin?: number | null;
  readonly onHoverBin?: (index: number | null) => void;
  readonly opacity?: number;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

function describeBin(data: HistogramData, index: number): string {
  const lo = data.domain.min + index * data.binWidth;
  const hi = lo + data.binWidth;
  return `Bin ${index}: ${lo.toFixed(3)} to ${hi.toFixed(3)}`;
}

/**
 * `GPUHistogram` — adaptive 1D histogram with GPU atomic binning and instanced bars.
 *
 * X pans and zooms over the value domain; Y is a normalised count axis baked into the shader.
 */
export function GPUHistogram(props: GPUHistogramProps): JSX.Element {
  const { data, onViewportChange, onHoverBin, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;

  const bounds: ViewportBounds = useMemo(
    () => ({
      timeMin: data.domain.min,
      timeMax: data.domain.max,
      rowMin: 0,
      rowMax: 1,
    }),
    [data.domain],
  );

  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Histogram",
    summary:
      `${data.finiteCount.toLocaleString("en-US")} values in ${data.binCount} bins ` +
      `(${data.method}). Domain ${data.domain.min.toFixed(3)} to ${data.domain.max.toFixed(3)}.`,
  });

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

  const componentRef = useRef<HistogramComponent | null>(null);
  const factory = useCallback(() => {
    const component = new HistogramComponent();
    componentRef.current = component;
    return component;
  }, []);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({
        data,
        viewport,
        binCount: props.binCount,
        hoveredBin: props.hoveredBin,
        opacity: props.opacity,
      }),
      [data, viewport, props.binCount, props.hoveredBin, props.opacity],
    ),
  );

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
        const controller = createViewportController(viewportRef.current, boundsRef.current);
        controller.panByPixels(-(state.x - dragFrom.x), 0);
        dragFrom = { x: state.x, y: state.y };
        setViewportRef.current(controller.getState());
        onHoverBin?.(null);
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHoverBin?.(hit ? Number(hit.id) : null);
    });

    const unsubLeave = pointer.onLeave(() => onHoverBin?.(null));

    const unsubUp = pointer.onUp((state) => {
      const start = dragFrom;
      dragFrom = null;
      if (start && Math.abs(state.x - start.x) < 3 && Math.abs(state.y - start.y) < 3) {
        const hit = componentRef.current?.hitTest(state.x, state.y);
        if (hit) a11y.announce(describeBin(data, Number(hit.id)));
      }
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaY } = normalizeWheel(e);
      const factor = Math.exp(deltaY * ZOOM_SPEED);
      const controller = createViewportController(viewportRef.current, boundsRef.current);
      controller.zoomAt(e.clientX - rect.left, factor);
      setViewportRef.current(controller.getState());
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      unsubDown();
      unsubMove();
      unsubUp();
      unsubLeave();
      detach();
      el.removeEventListener("wheel", onWheel);
    };
  }, [canvas, data, onHoverBin, a11y]);

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
      {props.hoveredBin != null && <div style={SR_ONLY}>{describeBin(data, props.hoveredBin)}</div>}
    </div>
  );
}
