import { createPointerController, createViewportController, normalizeWheel } from "@gpu-components/core";
import type { ViewportBounds, ViewportState } from "@gpu-components/core";
import { useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { GraphComponent } from "./GraphComponent.ts";
import type { GraphData } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;

export interface GPUGraphProps {
  readonly data: GraphData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly paused?: boolean;
  readonly nodeSizePx?: number;
  readonly edgeWidthPx?: number;
  readonly selectedNode?: number | null;
  /** Fires as the simulation runs, so a host can show progress or a settled state. */
  readonly onIterate?: (iterations: number, settled: boolean) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/**
 * `GPUGraph` — force-directed layout.
 *
 * **Deliberately thinner than the other wrappers**, and the reason is the component's defining
 * property: its node positions live only on the GPU and move every iteration, so there is nothing
 * on the CPU to hit-test against. `GraphComponent.hitTest()` returns null and says why; wiring
 * hover up means building `core`'s `Picker` (PLAN.md §9.5), which this component is the first real
 * justification for. Until then this wrapper offers pan, zoom, pause and an accessible summary —
 * and does not pretend to offer hover.
 *
 * The summary is live rather than static: a force layout is the one component here whose visual
 * state changes without user input, so "settling" and "settled" are information a screen-reader
 * user would otherwise have no way to obtain.
 */
export function GPUGraph(props: GPUGraphProps): JSX.Element {
  const { data, onViewportChange, onIterate, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const [progress, setProgress] = useState({ iterations: 0, settled: false });

  const bounds: ViewportBounds = useMemo(
    () => ({ timeMin: -4, timeMax: 4, rowMin: -4, rowMax: 4 }),
    [],
  );

  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Graph",
    summary:
      `${data.nodeCount.toLocaleString("en-US")} nodes, ${data.edgeCount.toLocaleString("en-US")} edges. ` +
      (progress.settled
        ? `Layout settled after ${progress.iterations} iterations.`
        : `Layout is still settling (${progress.iterations} iterations so far).`),
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

  // Held in a ref so the factory can install it without being re-created (which would remount).
  const progressRef = useRef(setProgress);
  progressRef.current = setProgress;

  const componentRef = useRef<GraphComponent | null>(null);
  const factory = useCallback(() => {
    const component = new GraphComponent();
    // Push, do not poll. Whichever instance is live is the one that reports, which is what makes
    // this correct under StrictMode's mount/unmount/mount.
    component.onProgress = (iterations, settled) => progressRef.current({ iterations, settled });
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
        paused: props.paused,
        nodeSizePx: props.nodeSizePx,
        edgeWidthPx: props.edgeWidthPx,
        selectedNode: props.selectedNode,
      }),
      [data, viewport, props.paused, props.nodeSizePx, props.edgeWidthPx, props.selectedNode],
    ),
  );

  useEffect(() => {
    onIterate?.(progress.iterations, progress.settled);
  }, [progress, onIterate]);

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
      if (!dragFrom || !state.dragging) return;
      const controller = createViewportController(viewportRef.current, bounds);
      controller.panByPixels(-(state.x - dragFrom.x), -(state.y - dragFrom.y));
      dragFrom = { x: state.x, y: state.y };
      setViewportRef.current(controller.getState());
    });
    const unsubUp = pointer.onUp(() => {
      dragFrom = null;
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaY } = normalizeWheel(e);
      const factor = Math.exp(deltaY * ZOOM_SPEED);
      const controller = createViewportController(viewportRef.current, bounds);
      controller.zoomAt(e.clientX - rect.left, factor);
      controller.zoomAtY(e.clientY - rect.top, factor);
      setViewportRef.current(controller.getState());
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      unsubDown();
      unsubMove();
      unsubUp();
      detach();
      el.removeEventListener("wheel", onWheel);
    };
  }, [canvas, bounds]);

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
