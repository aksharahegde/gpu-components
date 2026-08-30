import {
  assertBufferBudget,
  dispatchWorkgroups,
  InstancedQuadLayer,
  LINE_INSTANCE_STRIDE,
  LineLayer,
  RasterLayer,
  pixelXToTime,
  pixelYToTrack,
  trackedUniforms,
  viewportUniforms,
  writeLine,
} from "@gpu-components/core";
import type {
  BrushRect,
  ComponentContext,
  GpuComponent,
  HitResult,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpu-components/core";
import { compute, storage, uniforms } from "vgpu";
import type { Compute, Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { computeDomainMax, computeOrigin, INSTANCE_STRIDE, packHighlights, packInstances } from "./ingest.ts";
import type { SpanBuffers } from "./ingest.ts";
import { hitTestSpans } from "./hitTest.ts";
import { computeAxisRules, MAX_AXIS_RULES } from "./axisRules.ts";
import { TIMELINE_WGSL } from "./timeline.wgsl.ts";
import { HIGHLIGHT_WGSL } from "./highlight.wgsl.ts";
import { CULL_WGSL } from "./cull.wgsl.ts";
import { DENSITY_BIN_WGSL } from "./densityBin.wgsl.ts";
import { REDUCE_DENSITY_WGSL } from "./reduceDensity.wgsl.ts";
import { RASTER_WGSL } from "./raster.wgsl.ts";
import { BRUSH_SELECT_WGSL } from "./brushSelect.wgsl.ts";

export interface TimelineProps {
  readonly spans: SpanBuffers;
  readonly viewport: ViewportState;
  readonly hoveredId?: number | null;
  readonly selectedId?: number | null;
  /** PLAN.md §9.5's brush selection — a live GPU bitset highlight (`brushSelect.wgsl.ts`), distinct
   * from `selectedId`'s single-span highlight. `null`/omitted means no active brush. */
  readonly brushRect?: BrushRect | null;
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

interface BrushUniforms extends Record<string, unknown> {
  readonly timeStart: number;
  readonly timeEnd: number;
  readonly trackMin: number;
  readonly trackMax: number;
  readonly count: number;
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

/** Field-wise comparison of the two `ViewportState`s — `update()` receives a fresh object every
 * render, so reference equality would report a change on every hover. */
function viewportChanged(a: ViewportState, b: ViewportState): boolean {
  return (
    a.timeStart !== b.timeStart ||
    a.timeEnd !== b.timeEnd ||
    a.trackCount !== b.trackCount ||
    a.width !== b.width ||
    a.height !== b.height
  );
}

let nextId = 0;

/**
 * The first real `GpuComponent` (PLAN.md §12.2). One `InstancedQuadLayer` for spans, drawn via a
 * GPU-driven indirect draw whose instance count comes from `cull.wgsl.ts`'s compute pass — a
 * time-range visibility cull. When the current viewport's estimated spans-per-pixel-column exceeds
 * `lodThreshold`, this switches to a `RasterLayer` density field instead (`densityBin.wgsl.ts` +
 * `reduceDensity.wgsl.ts` + `raster.wgsl.ts`) so extreme zoom-out over a huge dataset draws one
 * value per pixel column, not every span — PLAN.md §12.2's full two-mode frame. Plus CPU hit-testing
 * (§9.5's primary mechanism for Timeline, not a GPU-picking fallback), a small second
 * `InstancedQuadLayer` for the hover/selection highlight, drawn uncompacted (at most two instances —
 * culling would cost more than it saves), and brush selection (`brushSelect.wgsl.ts`, PLAN.md §9.5's
 * "Hybrid" model): a per-span GPU bitset the main render shader reads directly, no separate draw or
 * CPU set, so it scales the same way the rest of the render path does. Keyboard navigation and the
 * accessibility overlay are wired in `GPUTimeline.tsx` (see its own doc comment); touch gestures and
 * true lasso/polygon selection remain out of scope (a rectangle is the natural shape for a 2D
 * track-row × time grid — see `brush.ts`'s doc comment).
 */
export class TimelineComponent implements GpuComponent<TimelineProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private readonly initialCapacity: number;
  /** PLAN.md §31 open question #4: spans-per-pixel-column crossover into raster LOD mode. */
  private readonly lodThreshold: number;
  private gpu: Gpu | null = null;
  /** Device limits, captured at `create()` so dispatches and allocations can be bounded against
   * them (PLAN.md §24.2). Before this existed they were probed and never read. */
  private caps: ComponentContext["caps"] | null = null;
  private warnings: ComponentContext["runtime"]["warnings"] | null = null;
  private layer: InstancedQuadLayer | null = null;
  private highlightLayer: InstancedQuadLayer | null = null;
  /** PLAN.md §12.2's axis rules, through `core`'s `LineLayer` (§12.1's second primitive). */
  private rulesLayer: LineLayer | null = null;
  /** Reused scratch for the rule instances, presized to `MAX_AXIS_RULES` so rebuilding the rules on
   * every viewport change (i.e. every pan/zoom frame) allocates nothing — PLAN.md §19.2's rule
   * about not churning in the loop applies to CPU allocation, not only GPU resources. */
  private readonly ruleScratch = new DataView(new ArrayBuffer(MAX_AXIS_RULES * LINE_INSTANCE_STRIDE));
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

  private brushPipeline: Compute | null = null;
  private brushParams: SharedUniforms<BrushUniforms> | null = null;
  private selectionMask: StorageBuffer | null = null;
  /** Zero-fill source for `selectionMask`, resized alongside it in `ensureSelectionCapacity`. */
  private zeroSelectionMask = new Uint32Array(0);
  /** Capacity in *words* (32 spans/word), not spans — matches `selectionMask`'s own packing. */
  private selectionWordCapacity = 0;
  private currentBrushRect: BrushRect | null = null;
  /** True while the previous frame had an active brush — lets `update()` detect the non-null → null
   * transition and zero `selectionMask` with one JS write (not a dispatch) so stale bits don't keep
   * rendering spans as selected after the brush clears. */
  private hadBrush = false;

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
    this.caps = ctx.caps;
    this.warnings = ctx.runtime.warnings;
    this.layer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: TIMELINE_WGSL,
      instanceStride: INSTANCE_STRIDE,
      capacity: this.initialCapacity,
      label: this.id,
      warnings: ctx.runtime.warnings,
    });
    this.highlightLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: HIGHLIGHT_WGSL,
      instanceStride: INSTANCE_STRIDE,
      capacity: 2,
      label: `${this.id}-highlight`,
      warnings: ctx.runtime.warnings,
    });
    // trackedUniforms (PLAN.md §28.2's "uniform writes with no change" anti-pattern), not plain
    // uniforms() — this is the component's most-frequently-`.set()` uniform (every update()).
    this.viewportUniform = trackedUniforms(
      ctx.gpu,
      { timeToClip: [1, 0], trackToClip: [1, 0], pxSize: [1, 1] },
      ctx.runtime.warnings,
      this.id,
    );
    this.layer.bindViewport(this.viewportUniform);
    this.highlightLayer.bindViewport(this.viewportUniform);

    // Presized to the rule ceiling, so this layer never grows after create() — the rule count
    // changes on every zoom, and a layer that grew with it would report a buffer-growth warning
    // (§28.2) for behaviour that is entirely expected here.
    this.rulesLayer = new LineLayer({
      gpu: ctx.gpu,
      capacity: MAX_AXIS_RULES,
      label: `${this.id}-rules`,
      warnings: ctx.runtime.warnings,
    });
    this.rulesLayer.bindViewport(this.viewportUniform);

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

    this.brushPipeline = compute(ctx.gpu, BRUSH_SELECT_WGSL);
    this.brushParams = uniforms(ctx.gpu, { timeStart: 0, timeEnd: 0, trackMin: 0, trackMax: 0, count: 0 });
    this.brushPipeline.set({ params: this.brushParams });
    this.selectionWordCapacity = 0;
    this.ensureSelectionCapacity(this.uploadedSpans?.count ?? this.initialCapacity);

    // The buffers allocated above are fresh GPU state with no data — re-upload whatever this
    // component last received, both on the very first create() and after a device-loss replay.
    // `originTime` is derived purely from `uploadedSpans` (not GPU state), so it already reflects
    // that dataset and does not need recomputing here.
    if (this.uploadedSpans) {
      this.layer.upload(packInstances(this.uploadedSpans, this.originTime), this.uploadedSpans.count);
      this.cullPipeline.set({ instances: this.layer.instances });
      this.densityBinPipeline.set({ instances: this.layer.instances });
      this.brushPipeline.set({ instances: this.layer.instances });
      this.uploadHighlights(this.uploadedSpans);
    }
    // Same reasoning as the span re-upload above: `rulesLayer` is fresh GPU state after a
    // device-loss replay, and the rules are a pure function of the viewport we already hold.
    if (this.currentViewport) this.uploadAxisRules(this.currentViewport);
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

  /** Grows `selectionMask` (1 bit/span, packed 32/word — hence the `/32` capacity check, unlike
   * `ensureCullCapacity`'s 1-slot-per-span buffers) if `spanCount` needs more words than currently
   * allocated. Bound to both `brushPipeline` and the main render `layer` — always, not just while a
   * brush is active, since `timeline.wgsl.ts`'s `isSelected()` reads it unconditionally (all-zero
   * words read as "nothing selected," which is exactly correct with no brush active). */
  private ensureSelectionCapacity(spanCount: number): void {
    const words = Math.max(1, Math.ceil(spanCount / 32));
    if (!this.gpu || words <= this.selectionWordCapacity) return;
    this.selectionWordCapacity = words;
    this.selectionMask = storage(this.gpu, this.selectionWordCapacity * 4, "read-write");
    this.zeroSelectionMask = new Uint32Array(this.selectionWordCapacity);
    this.brushPipeline?.set({ selectionMask: this.selectionMask });
    this.layer?.bind({ selectionMask: this.selectionMask });
  }

  update(props: TimelineProps): void {
    if (props.spans !== this.uploadedSpans) {
      // Fail with the real numbers before allocating, rather than letting WebGPU reject the buffer
      // (§14.3). Checked here because this is where a new dataset's size first becomes known.
      if (this.caps) {
        assertBufferBudget(this.caps, props.spans.count * INSTANCE_STRIDE, "GPUTimeline spans", INSTANCE_STRIDE);
      }
      this.originTime = computeOrigin(props.spans);
      this.domainSpan = computeDomainMax(props.spans) - this.originTime;
      this.layer?.upload(packInstances(props.spans, this.originTime), props.spans.count);
      this.ensureCullCapacity(props.spans.count);
      this.ensureSelectionCapacity(props.spans.count);
      if (this.layer) {
        this.cullPipeline?.set({ instances: this.layer.instances });
        this.densityBinPipeline?.set({ instances: this.layer.instances });
        this.brushPipeline?.set({ instances: this.layer.instances });
      }
      this.uploadedSpans = props.spans;
    }
    const previousViewport = this.currentViewport;
    this.currentViewport = props.viewport;
    // The rules depend only on the viewport, so a props change that left it untouched (a hover, a
    // selection) must not repack and re-upload them.
    if (!previousViewport || viewportChanged(previousViewport, props.viewport)) {
      this.uploadAxisRules(props.viewport);
    }
    this.ensureDensityCapacity(props.viewport.trackCount);
    this.lodMode = this.estimateLodMode(props.spans, props.viewport);

    const brushRect = props.brushRect ?? null;
    if (!brushRect && this.hadBrush) {
      // The brush just cleared — one JS-side zero-fill, not a dispatch, so stale bits don't keep
      // rendering spans as selected after this transition.
      this.selectionMask?.write(this.zeroSelectionMask);
    }
    this.hadBrush = brushRect != null;
    this.currentBrushRect = brushRect;
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

  /** Rebuilds the axis rules for `viewport` into the reused scratch buffer and uploads them. */
  private uploadAxisRules(viewport: ViewportState): void {
    if (!this.rulesLayer) return;
    const rules = computeAxisRules(viewport, this.originTime);
    for (let i = 0; i < rules.length; i++) writeLine(this.ruleScratch, i, rules[i]!);
    this.rulesLayer.upload(
      new Uint8Array(this.ruleScratch.buffer, 0, rules.length * LINE_INSTANCE_STRIDE),
      rules.length,
    );
  }

  /** Workgroup count for `count` items, clamped to the device limit and reported if it clamps. */
  private workgroupsFor(count: number, source: string): number {
    if (!this.caps) return Math.ceil(count / CULL_WORKGROUP_SIZE);
    return dispatchWorkgroups(this.caps, count, CULL_WORKGROUP_SIZE, {
      warnings: this.warnings ?? undefined,
      source,
    });
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
    const computePasses = raster
      ? [
          { name: "timeline-density-bin", dispatch: () => this.dispatchDensityBin() },
          { name: "timeline-reduce-density", dispatch: () => this.dispatchReduceDensity() },
        ]
      : [{ name: "timeline-cull", dispatch: () => this.dispatchCull() }];
    // Only declared while a brush is active — a cleared brush already zero-filled `selectionMask`
    // in `update()` via a plain write, no dispatch needed (PLAN.md §10.2: a clean component/pass
    // contributes nothing).
    if (this.currentBrushRect) {
      computePasses.push({ name: "timeline-brush-select", dispatch: () => this.dispatchBrushSelect() });
    }
    return {
      computePasses,
      renderPasses: [
        {
          name: "timeline",
          target: "surface",
          clear: true,
          encode: (pass) => {
            // Rules first, so spans occlude them rather than the reverse — gridlines belong behind
            // the data they measure. (PLAN.md §12.2 puts axis rules in a second overlay pass; with
            // one surface pass and alpha blending, draw order alone gets the same result for a
            // fraction of the encoding cost.)
            this.rulesLayer?.draw(pass);
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
    this.cullPipeline.dispatch(this.workgroupsFor(spans.count, "timeline-cull"));
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
    this.densityBinPipeline.dispatch(this.workgroupsFor(spans.count, "timeline-density-bin"));
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
    this.reduceDensityPipeline.dispatch(this.workgroupsFor(total, "timeline-reduce-density"));
  }

  /** Resets `selectionMask` to zero and dispatches `brushSelect.wgsl.ts` against the current
   * `currentBrushRect` — only called from `plan()`'s compute pass, which itself is only declared
   * while a brush is active (`plan()`'s own comment), so `currentBrushRect` is always set here. */
  private dispatchBrushSelect(): void {
    if (!this.selectionMask || !this.brushPipeline || !this.brushParams) return;
    this.selectionMask.write(this.zeroSelectionMask);

    const spans = this.uploadedSpans;
    const rect = this.currentBrushRect;
    if (!spans || !rect || spans.count === 0) return;

    this.brushParams.set({
      timeStart: rect.timeStart - this.originTime,
      timeEnd: rect.timeEnd - this.originTime,
      trackMin: rect.trackMin,
      trackMax: rect.trackMax,
      count: spans.count,
    });
    this.brushPipeline.dispatch(this.workgroupsFor(spans.count, "timeline-brush-select"));
  }

  dispose(): void {
    this.layer?.dispose();
    this.highlightLayer?.dispose();
    this.rulesLayer?.dispose();
    this.raster?.dispose();
  }
}
