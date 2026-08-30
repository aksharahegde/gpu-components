import { InstancedQuadLayer, pixelXToTime, pixelYToTrack, viewportUniforms } from "@gpu-components/core";
import type { ComponentContext, GpuComponent, HitResult, RenderPlan, ViewportState, ViewportUniforms } from "@gpu-components/core";
import { compute, storage, uniforms } from "vgpu";
import type { Compute, Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { computeOrigin, INSTANCE_STRIDE, packHighlights, packInstances } from "./ingest.ts";
import type { SpanBuffers } from "./ingest.ts";
import { hitTestSpans } from "./hitTest.ts";
import { TIMELINE_WGSL } from "./timeline.wgsl.ts";
import { HIGHLIGHT_WGSL } from "./highlight.wgsl.ts";
import { CULL_WGSL } from "./cull.wgsl.ts";

export interface TimelineProps {
  readonly spans: SpanBuffers;
  readonly viewport: ViewportState;
  readonly hoveredId?: number | null;
  readonly selectedId?: number | null;
}

interface CullUniforms extends Record<string, unknown> {
  readonly timeStart: number;
  readonly timeEnd: number;
  readonly count: number;
}

/** `cull.wgsl.ts`'s `@workgroup_size`. */
const CULL_WORKGROUP_SIZE = 64;
/** Non-indexed `drawIndirect` layout reset each dirty frame before dispatch: `vertexCount` is the
 * quad's fixed 6, `instanceCount` starts at 0 for the compute pass's atomic append to grow,
 * `firstVertex`/`firstInstance` are always 0 for this component. */
const RESET_INDIRECT_ARGS = new Uint32Array([6, 0, 0, 0]);

let nextId = 0;

/**
 * The first real `GpuComponent` (PLAN.md §12.2). One `InstancedQuadLayer` for spans, drawn via a
 * GPU-driven indirect draw whose instance count comes from `cull.wgsl.ts`'s compute pass — a
 * time-range visibility cull, not the full density-field LOD binning PLAN.md §12.2 also describes
 * (that stays a separate, larger follow-up: see PLAN.md's Phase 2 status note). Plus CPU
 * hit-testing (§9.5's primary mechanism for Timeline, not a GPU-picking fallback) and a small
 * second `InstancedQuadLayer` for the hover/selection highlight, drawn uncompacted (at most two
 * instances — culling would cost more than it saves). Keyboard navigation and the accessibility
 * overlay are wired in `GPUTimeline.tsx` (see its own doc comment); touch gestures and brush/lasso
 * selection remain deferred.
 */
export class TimelineComponent implements GpuComponent<TimelineProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private readonly initialCapacity: number;
  private gpu: Gpu | null = null;
  private layer: InstancedQuadLayer | null = null;
  private highlightLayer: InstancedQuadLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private cullPipeline: Compute | null = null;
  private cullParams: SharedUniforms<CullUniforms> | null = null;
  private visibleIndices: StorageBuffer | null = null;
  private indirectArgs: StorageBuffer | null = null;
  private cullCapacity = 0;
  private uploadedSpans: SpanBuffers | null = null;
  /** Dataset-local time origin (spikes/gpu-time-precision.md) — recomputed only when `spans`
   * identity changes, and subtracted from both the packed GPU buffers and the viewport uniforms so
   * clip-space math never operates directly on (possibly epoch-scale) absolute time. */
  private originTime = 0;
  private currentViewport: ViewportState | null = null;
  private currentHoveredId: number | null = null;
  private currentSelectedId: number | null = null;

  constructor(initialCapacity = 1024) {
    this.initialCapacity = Math.max(1, initialCapacity);
    this.id = `timeline-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
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

    this.cullPipeline = compute(ctx.gpu, CULL_WGSL);
    this.cullParams = uniforms(ctx.gpu, { timeStart: 0, timeEnd: 0, count: 0 });
    this.indirectArgs = storage(ctx.gpu, RESET_INDIRECT_ARGS.byteLength, { indirect: true });
    this.cullPipeline.set({ params: this.cullParams, args: this.indirectArgs });
    // `cullCapacity` is a plain field (not GPU state), so a device-loss replay's `create()` must
    // reset it — the previous `visibleIndices` buffer no longer exists — and let
    // `ensureCullCapacity` below reallocate to match `uploadedSpans`.
    this.cullCapacity = 0;
    this.ensureCullCapacity(this.uploadedSpans?.count ?? this.initialCapacity);

    // The buffers allocated above are fresh GPU state with no data — re-upload whatever this
    // component last received, both on the very first create() and after a device-loss replay.
    // `originTime` is derived purely from `uploadedSpans` (not GPU state), so it already reflects
    // that dataset and does not need recomputing here.
    if (this.uploadedSpans) {
      this.layer.upload(packInstances(this.uploadedSpans, this.originTime), this.uploadedSpans.count);
      this.cullPipeline.set({ instances: this.layer.instances });
      this.uploadHighlights(this.uploadedSpans);
    }
  }

  /** Grows `visibleIndices` (and re-binds it to both the compute pipeline and the render layer) if
   * `count` exceeds the current cull-buffer capacity — the same "grow on demand" pattern
   * `InstancedQuadLayer.upload()` already uses for the span buffer itself. */
  private ensureCullCapacity(count: number): void {
    if (!this.gpu || count <= this.cullCapacity) return;
    this.cullCapacity = Math.max(1, count);
    this.visibleIndices = storage(this.gpu, this.cullCapacity * 4, "read-write");
    this.cullPipeline?.set({ visibleIndices: this.visibleIndices });
    this.layer?.bind({ visibleIndices: this.visibleIndices });
  }

  update(props: TimelineProps): void {
    if (props.spans !== this.uploadedSpans) {
      this.originTime = computeOrigin(props.spans);
      this.layer?.upload(packInstances(props.spans, this.originTime), props.spans.count);
      this.ensureCullCapacity(props.spans.count);
      if (this.layer) this.cullPipeline?.set({ instances: this.layer.instances });
      this.uploadedSpans = props.spans;
    }
    this.currentViewport = props.viewport;
    this.viewportUniform?.set(
      viewportUniforms({
        ...props.viewport,
        timeStart: props.viewport.timeStart - this.originTime,
        timeEnd: props.viewport.timeEnd - this.originTime,
      }),
    );

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
    const { bytes, count } = packHighlights(spans, this.currentHoveredId, this.currentSelectedId, this.originTime);
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
      computePasses: [
        {
          name: "timeline-cull",
          dispatch: () => this.dispatchCull(),
        },
      ],
      renderPasses: [
        {
          name: "timeline",
          target: "surface",
          clear: true,
          encode: (pass) => {
            if (this.layer && this.indirectArgs) this.layer.drawIndirect(pass, this.indirectArgs);
            this.highlightLayer?.draw(pass);
          },
        },
      ],
    };
  }

  /** Resets the indirect-draw args (PLAN.md §12.2's `binSpans`) and, when there's data and a
   * viewport to cull against, dispatches `cull.wgsl.ts` to rebuild `visibleIndices` and
   * `indirectArgs.instanceCount` for this frame's render pass to read. The scheduler guarantees
   * this runs before that render pass encodes (PLAN.md §10.2 / `FrameScheduler.tick`). */
  private dispatchCull(): void {
    if (!this.indirectArgs || !this.cullPipeline) return;
    this.indirectArgs.write(RESET_INDIRECT_ARGS);

    const spans = this.uploadedSpans;
    const viewport = this.currentViewport;
    if (!spans || !viewport || spans.count === 0) return;

    this.cullParams?.set({
      timeStart: viewport.timeStart - this.originTime,
      timeEnd: viewport.timeEnd - this.originTime,
      count: spans.count,
    });
    this.cullPipeline.dispatch(Math.ceil(spans.count / CULL_WORKGROUP_SIZE));
  }

  dispose(): void {
    this.layer?.dispose();
    this.highlightLayer?.dispose();
  }
}
