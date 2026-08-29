import type { CSSProperties } from "react";
import { useCanvasRef, useGpuComponent } from "@gpu-components/react";
import type { ViewportState } from "@gpu-components/core";
import { TimelineComponent, type TimelineProps as TimelineComponentProps } from "./TimelineComponent.ts";
import { visibleLabels } from "./viewModel.ts";
import type { SpanBuffers } from "./ingest.ts";

export interface GPUTimelineProps {
  readonly spans: SpanBuffers;
  readonly viewport: ViewportState;
  readonly style?: CSSProperties;
  readonly className?: string;
}

/**
 * Thin React wrapper (PLAN.md §9.3 — components are registry source, not a package; §21's
 * declarative-props split). `viewport` is a fully controlled prop in v1: no imperative
 * `zoomTo()`/`select()` handle yet, and no gesture state machine — those are phase 3 (PLAN.md §29).
 */
export function GPUTimeline(props: GPUTimelineProps): JSX.Element {
  const { spans, viewport, style, className } = props;
  const [canvas, ref] = useCanvasRef();
  useGpuComponent<TimelineComponentProps>(
    () => new TimelineComponent(spans.count),
    canvas,
    { spans, viewport },
  );
  const labels = visibleLabels(spans, viewport);

  return (
    <div
      className={className}
      style={{ position: "relative", width: viewport.width, height: viewport.height, ...style }}
    >
      <canvas
        ref={ref}
        width={viewport.width}
        height={viewport.height}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {labels.map((label) => (
          <span
            key={label.id}
            style={{
              position: "absolute",
              left: label.x,
              top: label.y,
              width: label.width,
              height: label.height,
              lineHeight: `${label.height}px`,
              overflow: "hidden",
              whiteSpace: "nowrap",
              fontSize: 11,
              color: "#fff",
              paddingLeft: 4,
              boxSizing: "border-box",
              pointerEvents: "auto",
            }}
          >
            {label.text}
          </span>
        ))}
      </div>
    </div>
  );
}
