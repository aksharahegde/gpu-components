import { createPointerController, createViewportController, normalizeWheel } from "@gpuc/core";
import type { ViewportBounds, ViewportState } from "@gpuc/core";
import { SR_ONLY, useGpu, useGpuA11y, useGpuComponent } from "@gpuc/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { DensityMapComponent } from "./DensityMapComponent.ts";
import type { DensityMapData } from "./ingest.ts";
import type { ColormapName } from "./colormap.ts";
import { mercatorToLonLat } from "./mercator.ts";
import { offsetToAxial, offsetToPixel } from "./hexmath.ts";

const ZOOM_SPEED = 0.0015;

export interface GPUDensityMapProps {
  readonly data: DensityMapData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly hexSize?: number;
  readonly hexSizePx?: number;
  readonly colormap?: ColormapName;
  readonly hoveredIndex?: number | null;
  readonly onHoverHex?: (index: number | null) => void;
  readonly opacity?: number;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

function describeHex(component: DensityMapComponent | null, index: number): string {
  const layout = component?.layout;
  if (!layout) return `Hex ${index}`;
  const col = (index % layout.cols) + layout.minCol;
  const row = Math.floor(index / layout.cols) + layout.minRow;
  const { x, y } = offsetToPixel({ col, row }, layout.hexSize);
  const { lon, lat } = mercatorToLonLat(x, y);
  const axial = offsetToAxial({ col, row });
  return `Hex q=${axial.q} r=${axial.r} near ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
}

/**
 * `GPUDensityMap` — Web Mercator hexbin density with graticule / world-outline chrome.
 *
 * Pan/zoom both axes (heatmap gesture). Hover resolves the odd-r cell under the cursor on the CPU.
 */
export function GPUDensityMap(props: GPUDensityMapProps): JSX.Element {
  const { data, onViewportChange, onHoverHex, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;

  const bounds: ViewportBounds = useMemo(
    () => ({
      timeMin: data.bounds.xMin,
      timeMax: data.bounds.xMax,
      rowMin: data.bounds.yMin,
      rowMax: data.bounds.yMax,
    }),
    [data.bounds],
  );

  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Density map",
    summary:
      `${data.count.toLocaleString("en-US")} points hexbinned on a Web Mercator map. ` +
      `Longitude span ${viewport.timeStart.toFixed(0)} to ${viewport.timeEnd.toFixed(0)} m projected.`,
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

  const componentRef = useRef<DensityMapComponent | null>(null);
  const factory = useCallback(() => {
    const component = new DensityMapComponent();
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
        hexSize: props.hexSize,
        hexSizePx: props.hexSizePx,
        colormap: props.colormap,
        hoveredIndex: props.hoveredIndex,
        opacity: props.opacity,
      }),
      [data, viewport, props.hexSize, props.hexSizePx, props.colormap, props.hoveredIndex, props.opacity],
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
        controller.panByPixels(-(state.x - dragFrom.x), -(state.y - dragFrom.y));
        dragFrom = { x: state.x, y: state.y };
        setViewportRef.current(controller.getState());
        onHoverHex?.(null);
        return;
      }
      const hit = componentRef.current?.hitTest(state.x, state.y) ?? null;
      onHoverHex?.(hit ? Number(hit.id) : null);
    });

    const unsubLeave = pointer.onLeave(() => onHoverHex?.(null));

    const unsubUp = pointer.onUp((state) => {
      const start = dragFrom;
      dragFrom = null;
      if (start && Math.abs(state.x - start.x) < 3 && Math.abs(state.y - start.y) < 3) {
        const hit = componentRef.current?.hitTest(state.x, state.y);
        if (hit) a11y.announce(describeHex(componentRef.current, Number(hit.id)));
      }
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaY } = normalizeWheel(e);
      const factor = Math.exp(deltaY * ZOOM_SPEED);
      const controller = createViewportController(viewportRef.current, boundsRef.current);
      controller.zoomAt(e.clientX - rect.left, factor);
      controller.zoomAtY(e.clientY - rect.top, factor);
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
  }, [canvas, onHoverHex, a11y]);

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
      {props.hoveredIndex != null && (
        <div style={SR_ONLY}>{describeHex(componentRef.current, props.hoveredIndex)}</div>
      )}
    </div>
  );
}
