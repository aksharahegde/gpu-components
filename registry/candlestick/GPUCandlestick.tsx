import { normalizeWheel } from "@gpu-components/core";
import type { ViewportState } from "@gpu-components/core";
import { useGpu, useGpuA11y, useGpuComponent } from "@gpu-components/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { CandlestickComponent, type BarSource } from "./CandlestickComponent.ts";
import type { Bar } from "./ingest.ts";

const MIN_PITCH = 1.5;
const MAX_PITCH = 60;
const ZOOM_SPEED = 0.0018;

export interface GPUCandlestickProps {
  readonly source: BarSource;
  readonly viewport: ViewportState;
  readonly pitchPx?: number;
  readonly onPitchChange?: (pitch: number) => void;
  readonly follow?: boolean;
  readonly onFollowChange?: (follow: boolean) => void;
  readonly onHoverBar?: (bar: { index: number; bar: Bar } | null) => void;
  readonly overviewHeightPx?: number;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/**
 * `GPUCandlestick` — an OHLC chart over a streaming ring.
 *
 * **Zoom here is one number.** Every other zooming component in this project maps a domain to clip
 * space and scales the mapping; a candlestick chart does not work that way, because bars are laid
 * out by ordinal and must keep a constant pixel width whatever the price range is. So zoom changes
 * `pitchPx` — pixels per bar — and nothing else, and the price axis re-ranges itself from whatever
 * is then visible. That is why this wrapper has no `ViewportController`: there is no 2D domain to
 * control, and reusing one would have meant fighting it.
 *
 * Hovering reports the whole bar rather than an index, because a crosshair readout needs OHLC and
 * volume, and the component already holds the CPU mirror those come from.
 */
export function GPUCandlestick(props: GPUCandlestickProps): JSX.Element {
  const { source, viewport, onPitchChange, onFollowChange, onHoverBar, style, className } = props;
  const { status } = useGpu();

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [internalPitch, setInternalPitch] = useState(props.pitchPx ?? 8);
  const pitchPx = props.pitchPx ?? internalPitch;
  const [scrollLeftPx, setScrollLeftPx] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  const componentRef = useRef<CandlestickComponent | null>(null);
  const factory = useCallback(() => {
    const component = new CandlestickComponent();
    componentRef.current = component;
    return component;
  }, []);

  useGpuComponent(
    factory,
    canvas,
    useMemo(
      () => ({
        source,
        viewport,
        pitchPx,
        scrollLeftPx,
        follow: props.follow,
        hoveredBar: hovered,
        overviewHeightPx: props.overviewHeightPx,
      }),
      [source, viewport, pitchPx, scrollLeftPx, props.follow, hovered, props.overviewHeightPx],
    ),
  );

  const barCount = componentRef.current?.barCount ?? 0;
  const range = componentRef.current?.visiblePriceRange;

  const a11y = useGpuA11y({
    label: props["aria-label"] ?? "Price chart",
    summary:
      `${barCount.toLocaleString("en-US")} bars.` +
      (range ? ` Visible range ${range.min.toFixed(2)} to ${range.max.toFixed(2)}.` : "") +
      (props.follow ? " Following the latest bar." : ""),
  });

  // Follow mode moves the scroll itself; mirror it back so panning starts from where the eye is.
  useEffect(() => {
    const component = componentRef.current;
    if (!component || !props.follow) return;
    const offset = component.scrollOffsetPx;
    setScrollLeftPx((current) => (Math.abs(current - offset) > 0.5 ? offset : current));
  }, [props.follow, source.version, viewport.width, pitchPx]);

  const setPitch = useCallback(
    (next: number) => {
      const clamped = Math.min(MAX_PITCH, Math.max(MIN_PITCH, next));
      if (onPitchChange) onPitchChange(clamped);
      else setInternalPitch(clamped);
      return clamped;
    },
    [onPitchChange],
  );

  useEffect(() => {
    const el = canvas;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { deltaY } = normalizeWheel(e);

      if (e.shiftKey) {
        // Shift-wheel pans, the convention every charting tool uses.
        setScrollLeftPx((current) => Math.max(0, current + deltaY));
        if (deltaY < 0) onFollowChange?.(false);
        return;
      }

      // Zoom about the cursor: keep the bar under the pointer under the pointer.
      const component = componentRef.current;
      const cursorX = e.clientX - rect.left;
      const before = (component?.scrollOffsetPx ?? scrollLeftPx) + cursorX;
      const barUnderCursor = before / pitchPx;
      const next = setPitch(pitchPx * Math.exp(-deltaY * ZOOM_SPEED));
      setScrollLeftPx(Math.max(0, barUnderCursor * next - cursorX));
      onFollowChange?.(false);
    };

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const hit = componentRef.current?.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      const index = hit ? hit.id : null;
      setHovered(index);
      const bar = index === null ? null : componentRef.current?.barAt(index) ?? null;
      onHoverBar?.(bar && index !== null ? { index, bar } : null);
    };
    const onLeave = () => {
      setHovered(null);
      onHoverBar?.(null);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [canvas, pitchPx, scrollLeftPx, setPitch, onFollowChange, onHoverBar]);

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
