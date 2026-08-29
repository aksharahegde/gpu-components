import { InstancedQuadLayer, viewportUniforms } from "@gpu-components/core";
import type { ComponentContext, GpuComponent, RenderPlan, ViewportState, ViewportUniforms } from "@gpu-components/core";
import { uniforms } from "vgpu";
import type { SharedUniforms } from "vgpu";
import { INSTANCE_STRIDE, packInstances } from "./ingest.ts";
import type { SpanBuffers } from "./ingest.ts";
import { TIMELINE_WGSL } from "./timeline.wgsl.ts";

export interface TimelineProps {
  readonly spans: SpanBuffers;
  readonly viewport: ViewportState;
}

let nextId = 0;

/**
 * The first real `GpuComponent` (PLAN.md §12.2) — v1 scope only: one `InstancedQuadLayer` drawing
 * every span every frame via `draw(gpu, { vertices: 6 })`'s no-geometry path, no LOD binning, no
 * indirect draw, no hit-testing. Those are phase 3/4/5 concerns per `PLAN.md` §29 and are not needed
 * for spans to render and pan/zoom correctly.
 */
export class TimelineComponent implements GpuComponent<TimelineProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private readonly initialCapacity: number;
  private layer: InstancedQuadLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private uploadedSpans: SpanBuffers | null = null;

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
    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.layer.bindViewport(this.viewportUniform);
    // The buffer allocated above is fresh GPU state with no data — re-upload whatever this
    // component last received, both on the very first create() and after a device-loss replay.
    if (this.uploadedSpans) {
      this.layer.upload(packInstances(this.uploadedSpans), this.uploadedSpans.count);
    }
  }

  update(props: TimelineProps): void {
    if (props.spans !== this.uploadedSpans) {
      this.layer?.upload(packInstances(props.spans), props.spans.count);
      this.uploadedSpans = props.spans;
    }
    this.viewportUniform?.set(viewportUniforms(props.viewport));
    this.dirty = true;
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
          },
        },
      ],
    };
  }

  dispose(): void {
    this.layer?.dispose();
  }
}
