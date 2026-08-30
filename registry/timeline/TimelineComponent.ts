import { InstancedQuadLayer, RasterLayer, pixelXToTime, pixelYToTrack, viewportUniforms } from "@gpu-components/core";
import type { ComponentContext, GpuComponent, HitResult, RenderPlan, ViewportState, ViewportUniforms } from "@gpu-components/core";
import { compute, storage, uniforms } from "vgpu";
import type { Compute, Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { computeDomainMax, computeOrigin, INSTANCE_STRIDE, packHighlights, packInstances } from "./ingest.ts";
import type { SpanBuffers } from "./ingest.ts";
import { hitTestSpans } from "./hitTest.ts";
import { TIMELINE_WGSL } from "./timeline.wgsl.ts";
import { HIGHLIGHT_WGSL } from "./highlight.wgsl.ts";
import { CULL_WGSL } from "./cull.wgsl.ts";
import { DENSITY_BIN_WGSL } from "./densityBin.wgsl.ts";
import { REDUCE_DENSITY_WGSL } from "./reduceDensity.wgsl.ts";
import { RASTER_WGSL } from "./raster.wgsl.ts";

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

interface DensityUniforms extends Record<string, unknown> {
  readonly pixelColumns: number;
  readonly trackCount: number;
}

/** `cull.wgsl.ts`/`densityBin.wgsl.ts`/`reduceDensity.wgsl.ts`'s shared `@workgroup_size`. */
const CULL_WORKGROUP_SIZE = 64;
/** Non-indexed `drawIndirect` layout reset each dirty frame before dispatch: `vertexCount` is the
 * quad's fixed 6, `instanceCount` starts at 0 for the compute pass's atomic append to grow,
 * `firstVertex`/`firstInstance` are always 0 for this component. */
const RESET_INDIRECT_ARGS = new Uint32Array([6, 0, 0, 0]);
/** `densityBin.wgsl.ts`/`raster.wgsl.ts`'s fixed pixel-column bucket count — bounded and
 * independent of actual canvas width, same "bounded regardless of dataset size" approach as
 * `viewModel.ts`'s `MAX_LABELS` (see `densityBin.wgsl.ts`'s own doc comment for why). */
const PIXEL_COLUMNS = 512;
/** PLAN.md §31 open question #4's stated default LOD crossover: spans-per-pixel-column at which
 * `TimelineComponent` switches from drawing every visible span to the density-field raster. */
const DEFAULT_LOD_THRESHOLD = 4;

let nextId = 0;

/**
 * The first real `GpuComponent` (PLAN.md §12.2). One `InstancedQuadLayer` for spans, drawn via a
 * GPU-driven indirect draw whose instance count comes from `cull.wgsl.ts`'s compute pass — a
 * time-range visibility cull. When the current viewport's estimated spans-per-pixel-column exceeds
 * `lodThreshold`, this switches to a `RasterLayer` density field instead (`densityBin.wgsl.ts` +
 * `reduceDensity.wgsl.ts` + `raster.wgsl.ts`) so extreme zoom-out over a huge dataset draws one
 * value per pixel column, not every span — PLAN.md §12.2's full two-mode frame. Plus CPU hit-testing
 * (§9.5's primary mechanism for Timeline, not a GPU-picking fallback) and a small second
 * `InstancedQuadLayer` for the hover/selection highlight, drawn uncompacted (at most two instances —
 * culling would cost more than it saves). Keyboard navigation and the accessibility overlay are
 * wired in `GPUTimeline.tsx` (see its own doc comment); touch gestures and brush/lasso selection
 * remain deferred.
 */
export class TimelineComponent implements GpuComponent<TimelineProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private readonly initialCapacity: number;
  /** PLAN.md §31 open question #4: spans-per-pixel-column crossover into raster LOD mode. */
  private readonly lodThreshold: number;
  private gpu: Gpu | null = null;
  private layer: InstancedQuadLayer | null = null;
  private highlightLayer: InstancedQuadLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private cullPipeline: Compute | null = null;
  private cullParams: SharedUniforms<CullUniforms> | null = null;
  private visibleIndices: StorageBuffer | null = null;
  private indirectArgs: StorageBuffer | null = null;
  private cullCapacity = 0;

  private raster: RasterLayer | null = null;
  private densityBinPipeline: Compute | null = null;
  private reduceDensityPipeline: Compute | null = null;
  private densityParams: SharedUniforms<DensityUniforms> | null = null;
  private densityBuffer: StorageBuffer | null = null;
  private maxPerTrackBuffer: StorageBuffer | null = null;
  /** Zero-fill sources for `densityBuffer`/`maxPerTrackBuffer`, resized alongside them in
   * `ensureDensityCapacity` so the per-frame reset (`dispatchDensityBin`/`dispatchReduceDensity`)
   * never allocates. */
  private zeroDensity = new Uint32Array(0);
  private zeroMaxPerTrack = new Uint32Array(0);
  private trackCapacity = 0;
  /** `"instanced" | "raster"` — recomputed in `update()` from the CPU-only heuristic
   * `estimateSpansPerPixelColumn` against `lodThreshold`, never from a GPU readback. */
  private lodMode: "instanced" | "raster" = "instanced";
  /** `computeDomainMax(spans) - originTime` — the dataset's total time extent, cached alongside
   * `originTime` (recomputed only when `spans` identity changes) for the LOD heuristic. */
  private domainSpan = 0;

  private uploadedSpans: SpanBuffers | null = null;
  /** Dataset-local time origin (spikes/gpu-time-precision.md) — recomputed only when `spans`
   * identity changes, and subtracted from both the packed GPU buffers and the viewport uniforms so
   * clip-space math never operates directly on (possibly epoch-scale) absolute time. */
  private originTime = 0;
  private currentViewport: ViewportState | null = null;
  private currentHoveredId: number | null = null;
  private currentSelectedId: number | null = null;

  constructor(initialCapacity = 1024, lodThreshold = DEFAULT_LOD_THRESHOLD) {
    this.initialCapacity = Math.max(1, initialCapacity);
    this.lodThreshold = lodThreshold;
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

    this.raster = new RasterLayer({ gpu: ctx.gpu, shader: RASTER_WGSL, label: `${this.id}-raster` });
    this.raster.bind({ viewport: this.viewportUniform });
    this.densityBinPipeline = compute(ctx.gpu, DENSITY_BIN_WGSL);
    this.reduceDensityPipeline = compute(ctx.gpu, REDUCE_DENSITY_WGSL);
    this.densityParams = uniforms(ctx.gpu, { pixelColumns: PIXEL_COLUMNS, trackCount: 0 });
    // `cullParams` (the same `{timeStart, timeEnd, count}` object bound to `cullPipeline` above) is
    // byte-compatible with `densityBin.wgsl.ts`'s own `CullParams` struct — `uniforms()` reuses one
    // stable buffer across shaders that share a layout, so this is a real re-bind, not a duplicate.
    this.densityBinPipeline.set({ params: this.cullParams, density_params: this.densityParams });
    this.reduceDensityPipeline.set({ density_params: this.densityParams });
    this.raster.bind({ density_params: this.densityParams });
    this.trackCapacity = 0;
    this.ensureDensityCapacity(this.currentViewport?.trackCount ?? 1);

    // The buffers allocated above are fresh GPU state with no data — re-upload whatever this
    // component last received, both on the very first create() and after a device-loss replay.
    // `originTime` is derived purely from `uploadedSpans` (not GPU state), so it already reflects
    // that dataset and does not need recomputing here.
    if (this.uploadedSpans) {
      this.layer.upload(packInstances(this.uploadedSpans, this.originTime), this.uploadedSpans.count);
      this.cullPipeline.set({ instances: this.layer.instances });
      this.densityBinPipeline.set({ instances: this.layer.instances });
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

  /** Grows `densityBuffer`/`maxPerTrackBuffer` (and their zero-fill sources) if `trackCount`
   * exceeds the current capacity — same "grow on demand" pattern as `ensureCullCapacity`. */
  private ensureDensityCapacity(trackCount: number): void {
    if (!this.gpu || trackCount <= this.trackCapacity) return;
    this.trackCapacity = Math.max(1, trackCount);
    this.densityBuffer = storage(this.gpu, this.trackCapacity * PIXEL_COLUMNS * 4, "read-write");
    this.maxPerTrackBuffer = storage(this.gpu, this.trackCapacity * 4, "read-write");
    this.zeroDensity = new Uint32Array(this.trackCapacity * PIXEL_COLUMNS);
    this.zeroMaxPerTrack = new Uint32Array(this.trackCapacity);
    this.densityBinPipeline?.set({ density: this.densityBuffer });
    this.reduceDensityPipeline?.set({ density: this.densityBuffer, maxPerTrack: this.maxPerTrackBuffer });
    this.raster?.bind({ density: this.densityBuffer, maxPerTrack: this.maxPerTrackBuffer });
  }

  update(props: TimelineProps): void {
    if (props.spans !== this.uploadedSpans) {
      this.originTime = computeOrigin(props.spans);
      this.domainSpan = computeDomainMax(props.spans) - this.originTime;
      this.layer?.upload(packInstances(props.spans, this.originTime), props.spans.count);
      this.ensureCullCapacity(props.spans.count);
      if (this.layer) {
        this.cullPipeline?.set({ instances: this.layer.instances });
        this.densityBinPipeline?.set({ instances: this.layer.instances });
      }
      this.uploadedSpans = props.spans;
    }
    this.currentViewport = props.viewport;
    this.ensureDensityCapacity(props.viewport.trackCount);
    this.lodMode = this.estimateLodMode(props.spans, props.viewport);
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

  /**
   * PLAN.md §31 open question #4's CPU-only LOD heuristic — no GPU readback. Approximates
   * spans-per-pixel-column as `(total spans × visible time fraction) / viewport width`, assuming a
   * roughly even distribution over the dataset's time domain (`domainSpan`, cached from
   * `computeDomainMax` when `spans` last changed). It's an estimate, not an exact density — real
   * density (which this heuristic's own raster-mode output computes) can only be known after
   * `densityBin.wgsl.ts` runs, and the whole point of a CPU heuristic is deciding *before* spending
   * GPU work on either mode.
   */
  private estimateLodMode(spans: SpanBuffers, viewport: ViewportState): "instanced" | "raster" {
    if (spans.count === 0 || viewport.width <= 0) return "instanced";
    const visibleSpan = Math.max(viewport.timeEnd - viewport.timeStart, 1e-9);
    const domainSpan = Math.max(this.domainSpan, 1e-9);
    const visibleFraction = Math.min(1, visibleSpan / domainSpan);
    const estimate = (spans.count * visibleFraction) / viewport.width;
    return estimate >= this.lodThreshold ? "raster" : "instanced";
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
    const raster = this.lodMode === "raster";
    return {
      computePasses: raster
        ? [
            { name: "timeline-density-bin", dispatch: () => this.dispatchDensityBin() },
            { name: "timeline-reduce-density", dispatch: () => this.dispatchReduceDensity() },
          ]
        : [{ name: "timeline-cull", dispatch: () => this.dispatchCull() }],
      renderPasses: [
        {
          name: "timeline",
          target: "surface",
          clear: true,
          encode: (pass) => {
            if (raster) {
              this.raster?.draw(pass);
            } else if (this.layer && this.indirectArgs) {
              this.layer.drawIndirect(pass, this.indirectArgs);
            }
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

  /** Resets `densityBuffer` to zero and, when there's data and a viewport, dispatches
   * `densityBin.wgsl.ts` — one thread per span, atomically incrementing its start-time bucket
   * (`densityBin.wgsl.ts`'s own doc comment covers the stated start-time-only approximation). Also
   * writes `density_params` (`cullParams`/`densityParams` are shared uniform objects — see
   * `create()`'s comment — so both this and `dispatchReduceDensity()` read the same values). */
  private dispatchDensityBin(): void {
    if (!this.densityBuffer || !this.densityBinPipeline || !this.densityParams) return;
    this.densityBuffer.write(this.zeroDensity);

    const viewport = this.currentViewport;
    if (!viewport) return;
    this.densityParams.set({ pixelColumns: PIXEL_COLUMNS, trackCount: viewport.trackCount });

    const spans = this.uploadedSpans;
    if (!spans || spans.count === 0) return;
    this.cullParams?.set({
      timeStart: viewport.timeStart - this.originTime,
      timeEnd: viewport.timeEnd - this.originTime,
      count: spans.count,
    });
    this.densityBinPipeline.dispatch(Math.ceil(spans.count / CULL_WORKGROUP_SIZE));
  }

  /** Resets `maxPerTrackBuffer` to zero and dispatches `reduceDensity.wgsl.ts` — one thread per
   * `(track, column)` cell — to fold `densityBuffer` (written by `dispatchDensityBin()`, which the
   * scheduler always runs first within this component's `computePasses` array) down to a per-track
   * max for `raster.wgsl.ts`'s color normalization. */
  private dispatchReduceDensity(): void {
    if (!this.maxPerTrackBuffer || !this.reduceDensityPipeline) return;
    this.maxPerTrackBuffer.write(this.zeroMaxPerTrack);

    const viewport = this.currentViewport;
    if (!viewport || viewport.trackCount === 0) return;
    const total = PIXEL_COLUMNS * viewport.trackCount;
    this.reduceDensityPipeline.dispatch(Math.ceil(total / CULL_WORKGROUP_SIZE));
  }

  dispose(): void {
    this.layer?.dispose();
    this.highlightLayer?.dispose();
    this.raster?.dispose();
  }
}
