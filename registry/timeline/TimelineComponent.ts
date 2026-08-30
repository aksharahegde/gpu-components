import { InstancedQuadLayer, pixelXToTime, pixelYToTrack, viewportUniforms } from "@gpu-components/core";
import type { ComponentContext, GpuComponent, HitResult, RenderPlan, ViewportState, ViewportUniforms } from "@gpu-components/core";
import { uniforms } from "vgpu";
import type { SharedUniforms } from "vgpu";
import { INSTANCE_STRIDE, packHighlights, packInstances } from "./ingest.ts";
import type { SpanBuffers } from "./ingest.ts";
import { hitTestSpans } from "./hitTest.ts";
import { TIMELINE_WGSL } from "./timeline.wgsl.ts";
import { HIGHLIGHT_WGSL } from "./highlight.wgsl.ts";

export interface TimelineProps {
  readonly spans: SpanBuffers;
  readonly viewport: ViewportState;
  readonly hoveredId?: number | null;
  readonly selectedId?: number | null;
}

let nextId = 0;

/**
 * The first real `GpuComponent` (PLAN.md §12.2). v1 scope: one `InstancedQuadLayer` drawing every
 * span every frame via `draw(gpu, { vertices: 6 })`'s no-geometry path (no LOD binning, no indirect
 * draw — phase 4), plus CPU hit-testing (§9.5's primary mechanism for Timeline, not a GPU-picking
 * fallback) and a small second `InstancedQuadLayer` for the hover/selection highlight. Keyboard
 * navigation and the accessibility overlay are wired in `GPUTimeline.tsx` (see its own doc comment);
 * touch gestures and brush/lasso selection remain deferred.
 */
export class TimelineComponent implements GpuComponent<TimelineProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private readonly initialCapacity: number;
  private layer: InstancedQuadLayer | null = null;
  private highlightLayer: InstancedQuadLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private uploadedSpans: SpanBuffers | null = null;
  private currentViewport: ViewportState | null = null;
  private currentHoveredId: number | null = null;
  private currentSelectedId: number | null = null;

  constructor(initialCapacity = 1024) {
    this.initialCapacity = Math.max(1, initialCapacity);
    this.id = `timeline-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.layer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: TIMELINE_WGSL,
      instanceStride: INSTANCE_STRIDE,
      capacity: this.initialCapacity,
      label: this.id,
    });
    this.highlightLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: HIGHLIGHT_WGSL,
      instanceStride: INSTANCE_STRIDE,
      capacity: 2,
      label: `${this.id}-highlight`,
    });
    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.layer.bindViewport(this.viewportUniform);
    this.highlightLayer.bindViewport(this.viewportUniform);

    // The buffers allocated above are fresh GPU state with no data — re-upload whatever this
    // component last received, both on the very first create() and after a device-loss replay.
    if (this.uploadedSpans) {
      this.layer.upload(packInstances(this.uploadedSpans), this.uploadedSpans.count);
      this.uploadHighlights(this.uploadedSpans);
    }
  }

  update(props: TimelineProps): void {
    if (props.spans !== this.uploadedSpans) {
      this.layer?.upload(packInstances(props.spans), props.spans.count);
      this.uploadedSpans = props.spans;
    }
    this.currentViewport = props.viewport;
    this.viewportUniform?.set(viewportUniforms(props.viewport));

    const hoveredId = props.hoveredId ?? null;
    const selectedId = props.selectedId ?? null;
    if (hoveredId !== this.currentHoveredId || selectedId !== this.currentSelectedId) {
      this.currentHoveredId = hoveredId;
      this.currentSelectedId = selectedId;
      this.uploadHighlights(props.spans);
    }
    this.dirty = true;
  }

  private uploadHighlights(spans: SpanBuffers): void {
    const { bytes, count } = packHighlights(spans, this.currentHoveredId, this.currentSelectedId);
    this.highlightLayer?.upload(bytes, count);
  }

  /** CPU hit-testing (PLAN.md §9.5) — O(log n) binary search, no frame of latency. */
  hitTest(x: number, y: number): HitResult | null {
    if (!this.currentViewport || !this.uploadedSpans) return null;
    const track = Math.round(pixelYToTrack(this.currentViewport, y));
    if (track < 0 || track >= this.currentViewport.trackCount) return null;
    const time = pixelXToTime(this.currentViewport, x);
    const index = hitTestSpans(this.uploadedSpans, track, time);
    return index === null ? null : { id: index };
  }

  plan(): RenderPlan {
    this.dirty = false;
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "timeline",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.layer?.draw(pass);
            this.highlightLayer?.draw(pass);
          },
        },
      ],
    };
  }

  dispose(): void {
    this.layer?.dispose();
    this.highlightLayer?.dispose();
  }
}
