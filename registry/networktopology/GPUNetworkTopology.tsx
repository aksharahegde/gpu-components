import { createPointerController, createViewportController, normalizeWheel } from "@gpuc/core";
import type { ViewportBounds, ViewportState } from "@gpuc/core";
import { useGpu, useGpuA11y, useGpuComponent } from "@gpuc/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { NetworkTopologyComponent } from "./NetworkTopologyComponent.ts";
import { STATUS, type TopologyData } from "./ingest.ts";

const ZOOM_SPEED = 0.0015;

export interface GPUNetworkTopologyProps {
  readonly data: TopologyData;
  readonly viewport: ViewportState;
  readonly onViewportChange?: (viewport: ViewportState) => void;
  readonly paused?: boolean;
  readonly nodeSizePx?: number;
  readonly edgeWidthPx?: number;
  readonly selectedNode?: number | null;
  /** Multiplier on how fast the traffic pulse travels along a hot edge. Defaults to 1. */
  readonly pulseSpeed?: number;
  /** Fires as the layout runs, so a host can show progress or a settled state. */
  readonly onIterate?: (iterations: number, settled: boolean) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/**
 * `GPUNetworkTopology` — force-directed service-mesh layout with a traffic pulse on hot edges.
 *
 * Structurally `GPUGraph`'s wrapper (pan, zoom, pause, live a11y summary; no hover, for the same
 * reason `GPUGraph` has none — positions live only on the GPU, so there is nothing on the CPU to
 * hit-test) plus one addition: the pulse in `topology.wgsl.ts`'s edge fragment shader is a function
 * of a `time` uniform that `NetworkTopologyComponent` does not advance on its own. This wrapper
 * owns that clock — a `requestAnimationFrame` loop advances local `time` state while not paused,
 * so hot links keep shimmering even after the layout settles (`NetworkTopologyComponent`'s doc
 * comment on why `animating` outlives `iterations >= MAX_ITERATIONS`).
 *
 * **No label overlay in v1.** The spec allows a capped `LabelOverlay` for schematic-scale meshes
 * using seed positions, but seed positions drift from the GPU-resident layout as it settles — an
 * overlay built from them would silently lie about where nodes actually are. Skipped in favor of
 * an honest a11y summary (counts + status tallies + settling state) until positions can be read
 * back cheaply enough to keep labels truthful.
 */
export function GPUNetworkTopology(props: GPUNetworkTopologyProps): JSX.Element {
  const { data, onViewportChange, onIterate, style, className } = props;
  const { status } = useGpu();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalViewport, setInternalViewport] = useState(props.viewport);
  const viewport = onViewportChange ? props.viewport : internalViewport;
  const [progress, setProgress] = useState({ iterations: 0, settled: false });
  const [time, setTime] = useState(0);

  const bounds: ViewportBounds = useMemo(
    () => ({ timeMin: -4, timeMax: 4, rowMin: -4, rowMax: 4 }),
    [],
  );

  const statusCounts = useMemo(() => {
    let up = 0;
    let degraded = 0;
    let down = 0;
    for (let i = 0; i < data.nodeCount; i++) {
      const s = data.status[i];
      if (s === STATUS.down) down++;
      else if (s === STATUS.degraded) degraded++;
      else up++;
    }
    return { up, degraded, down };
  }, [data]);

  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Network topology",
    summary:
      `${data.nodeCount.toLocaleString("en-US")} nodes ` +
      `(${statusCounts.up} up, ${statusCounts.degraded} degraded, ${statusCounts.down} down), ` +
      `${data.edgeCount.toLocaleString("en-US")} edges. ` +
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

  const componentRef = useRef<NetworkTopologyComponent | null>(null);
  const factory = useCallback(() => {
    const component = new NetworkTopologyComponent();
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
        pulseSpeed: props.pulseSpeed,
        time,
      }),
      [data, viewport, props.paused, props.nodeSizePx, props.edgeWidthPx, props.selectedNode, props.pulseSpeed, time],
    ),
  );

  useEffect(() => {
    onIterate?.(progress.iterations, progress.settled);
  }, [progress, onIterate]);

  // The pulse clock: keeps advancing `time` every frame while not paused, independent of whether
  // the force layout itself is still settling — see the class doc for why the two are decoupled.
  const pausedRef = useRef(props.paused);
  pausedRef.current = props.paused;
  const timeRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last != null && !pausedRef.current) {
        timeRef.current += (now - last) / 1000;
        setTime(timeRef.current);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
