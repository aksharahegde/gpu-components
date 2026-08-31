import {
  assertBufferBudget,
  dispatchWorkgroups,
  InstancedQuadLayer,
  LineLayer,
  pixelXToTime,
  viewportUniforms,
} from "@gpu-components/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpu-components/core";
import { compute, storage, uniforms } from "vgpu";
import type { Compute, Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { packValues, VALUE_STRIDE, withBinCount, type HistogramData } from "./ingest.ts";
import { MAX_BINS } from "./bins.ts";
import { BIN_WGSL, BIN_WORKGROUP_SIZE } from "./bin.wgsl.ts";
import { REDUCE_MAX_WGSL, REDUCE_MAX_WORKGROUP_SIZE } from "./reduce.wgsl.ts";
import { BAR_INSTANCE_STRIDE, BARS_WGSL } from "./bars.wgsl.ts";
import { computeAxisRules, MAX_AXIS_RULES } from "./axisRules.ts";

export interface HistogramProps {
  readonly data: HistogramData;
  readonly viewport: ViewportState;
  /** Overrides adaptive / ingest bin count; triggers a re-bin with the same values. */
  readonly binCount?: number;
  readonly hoveredBin?: number | null;
  readonly opacity?: number;
}

interface BinUniforms extends Record<string, unknown> {
  readonly domainMin: number;
  readonly domainSpan: number;
  readonly binCount: number;
  readonly count: number;
}

interface BarUniforms extends Record<string, unknown> {
  readonly domainMin: number;
  readonly binWidth: number;
  readonly binCount: number;
  readonly hoveredBin: number;
  readonly gapFrac: number;
  readonly opacity: number;
  readonly _pad0: number;
  readonly _pad1: number;
}

interface ReduceUniforms extends Record<string, unknown> {
  readonly binCount: number;
}

const GAP_FRAC = 0.12;

let nextId = 0;

/**
 * `GPUHistogram` — PLAN.md §6's distribution candidate (112.5).
 *
 * Adaptive bin layout (Freedman–Diaconis / Sturges) is decided at ingest; the GPU atomically
 * fills those buckets and draws instanced bars. Pan/zoom is a viewport uniform write over an
 * immutable value buffer.
 */
export class HistogramComponent implements GpuComponent<HistogramProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private warnings: ComponentContext["runtime"]["warnings"] | null = null;

  private barLayer: InstancedQuadLayer | null = null;
  private rulesLayer: LineLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private binParams: SharedUniforms<BinUniforms> | null = null;
  private barParams: SharedUniforms<BarUniforms> | null = null;
  private reduceParams: SharedUniforms<ReduceUniforms> | null = null;

  private valuesBuffer: StorageBuffer | null = null;
  private binsBuffer: StorageBuffer | null = null;
  private maxCountBuffer: StorageBuffer | null = null;
  private binPipeline: Compute | null = null;
  private reducePipeline: Compute | null = null;

  private valueCapacity = 0;
  private binCapacity = 0;
  private zeroBins: Uint32Array<ArrayBuffer> = new Uint32Array(new ArrayBuffer(0));
  private barPlaceholder: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));

  private sourceData: HistogramData | null = null;
  private activeData: HistogramData | null = null;
  private currentViewport: ViewportState | null = null;
  private hoveredBin = -1;
  private opacity = 0.9;
  private binsDirty = true;

  constructor() {
    this.id = `histogram-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;
    this.warnings = ctx.runtime.warnings;

    this.barLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: BARS_WGSL,
      instanceStride: BAR_INSTANCE_STRIDE,
      capacity: MAX_BINS,
      label: `${this.id}-bars`,
      warnings: ctx.runtime.warnings,
    });
    this.rulesLayer = new LineLayer({
      gpu: ctx.gpu,
      capacity: MAX_AXIS_RULES,
      label: `${this.id}-rules`,
      warnings: ctx.runtime.warnings,
    });

    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.binParams = uniforms(ctx.gpu, { domainMin: 0, domainSpan: 1, binCount: 1, count: 0 });
    this.barParams = uniforms(ctx.gpu, {
      domainMin: 0,
      binWidth: 1,
      binCount: 1,
      hoveredBin: -1,
      gapFrac: GAP_FRAC,
      opacity: 0.9,
      _pad0: 0,
      _pad1: 0,
    });
    this.reduceParams = uniforms(ctx.gpu, { binCount: 1 });

    this.binPipeline = compute(ctx.gpu, BIN_WGSL);
    this.reducePipeline = compute(ctx.gpu, REDUCE_MAX_WGSL);
    this.maxCountBuffer = storage(ctx.gpu, 4, "read-write");

    this.barLayer.bindViewport(this.viewportUniform);
    this.rulesLayer.bindViewport(this.viewportUniform);
    this.barLayer.bind({
      params: this.barParams,
      maxCount: this.maxCountBuffer,
    });
    this.binPipeline.set({ params: this.binParams });
    this.reducePipeline.set({ params: this.reduceParams, maxCount: this.maxCountBuffer });

    this.ensureValueCapacity(this.sourceData?.count ?? 1);
    this.ensureBinCapacity(1);

    if (this.sourceData) this.uploadValues(this.activeData ?? this.sourceData);
    if (this.currentViewport) {
      this.writeViewport(this.currentViewport);
      this.syncBinLayout();
      this.uploadRules(this.currentViewport);
    }
  }

  private ensureValueCapacity(count: number): void {
    if (!this.gpu || count <= this.valueCapacity) return;
    if (this.caps) assertBufferBudget(this.caps, count * VALUE_STRIDE, "GPUHistogram values", VALUE_STRIDE);
    this.valueCapacity = Math.max(1, count);
    this.valuesBuffer = storage(this.gpu, this.valueCapacity * VALUE_STRIDE, "read");
    this.binPipeline?.set({ values: this.valuesBuffer });
  }

  private ensureBinCapacity(binCount: number): void {
    if (!this.gpu) return;
    const n = Math.max(1, binCount);
    if (n <= this.binCapacity && this.binsBuffer) return;
    this.binCapacity = n;
    this.binsBuffer = storage(this.gpu, this.binCapacity * 4, "read-write");
    this.zeroBins = new Uint32Array(new ArrayBuffer(this.binCapacity * 4));
    this.barPlaceholder = new Uint8Array(new ArrayBuffer(this.binCapacity * BAR_INSTANCE_STRIDE));
    this.binPipeline?.set({ bins: this.binsBuffer });
    this.reducePipeline?.set({ bins: this.binsBuffer });
    this.barLayer?.bind({ bins: this.binsBuffer });
  }

  private uploadValues(data: HistogramData): void {
    this.ensureValueCapacity(data.count);
    this.valuesBuffer?.write(packValues(data));
  }

  private writeViewport(viewport: ViewportState): void {
    this.viewportUniform?.set(viewportUniforms(viewport));
  }

  private syncBinLayout(): void {
    const data = this.activeData;
    if (!data) return;
    this.ensureBinCapacity(data.binCount);
    this.barLayer?.upload(this.barPlaceholder, data.binCount);

    const span = data.domain.max - data.domain.min;
    this.binParams?.set({
      domainMin: data.domain.min,
      domainSpan: span,
      binCount: data.binCount,
      count: data.count,
    });
    this.barParams?.set({
      domainMin: data.domain.min,
      binWidth: data.binWidth,
      binCount: data.binCount,
      hoveredBin: this.hoveredBin,
      gapFrac: GAP_FRAC,
      opacity: this.opacity,
      _pad0: 0,
      _pad1: 0,
    });
    this.reduceParams?.set({ binCount: data.binCount });
    this.binsDirty = true;
  }

  private uploadRules(viewport: ViewportState): void {
    this.rulesLayer?.uploadLines(computeAxisRules(viewport));
  }

  private resolveActive(data: HistogramData, binCount?: number): HistogramData {
    if (binCount === undefined) return data;
    return withBinCount(data, binCount);
  }

  update(props: HistogramProps): void {
    this.hoveredBin = props.hoveredBin ?? -1;
    this.opacity = props.opacity ?? 0.9;

    const nextActive = this.resolveActive(props.data, props.binCount);
    const dataChanged = props.data !== this.sourceData;
    const layoutChanged =
      dataChanged ||
      this.activeData?.binCount !== nextActive.binCount ||
      this.activeData?.domain.min !== nextActive.domain.min ||
      this.activeData?.domain.max !== nextActive.domain.max;

    if (dataChanged) {
      this.sourceData = props.data;
      this.uploadValues(nextActive);
    }

    this.activeData = nextActive;
    this.currentViewport = props.viewport;
    this.writeViewport(props.viewport);

    if (layoutChanged) {
      this.syncBinLayout();
    } else {
      this.barParams?.set({
        domainMin: nextActive.domain.min,
        binWidth: nextActive.binWidth,
        binCount: nextActive.binCount,
        hoveredBin: this.hoveredBin,
        gapFrac: GAP_FRAC,
        opacity: this.opacity,
        _pad0: 0,
        _pad1: 0,
      });
    }

    this.uploadRules(props.viewport);
    this.dirty = true;
  }

  /** Bucket under the cursor from the *data* domain edges, not the visible viewport alone —
   * pan/zoom still maps pixel → value via the viewport, then into a bin index. */
  hitTest(x: number, _y: number): HitResult | null {
    const viewport = this.currentViewport;
    const data = this.activeData;
    if (!viewport || !data) return null;
    const value = pixelXToTime(viewport, x);
    if (value < data.domain.min || value > data.domain.max) return null;
    const span = data.domain.max - data.domain.min;
    let b = Math.floor(((value - data.domain.min) / span) * data.binCount);
    if (b >= data.binCount) b = data.binCount - 1;
    if (b < 0) return null;
    return { id: b };
  }

  get data(): HistogramData | null {
    return this.activeData;
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.activeData || !this.currentViewport) {
      return { computePasses: [], renderPasses: [] };
    }

    const computePasses = this.binsDirty
      ? [
          { name: "histogram-bin", dispatch: () => this.dispatchBin() },
          { name: "histogram-reduce-max", dispatch: () => this.dispatchReduceMax() },
        ]
      : [];
    this.binsDirty = false;

    return {
      computePasses,
      renderPasses: [
        {
          name: "histogram",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.barLayer?.draw(pass);
            this.rulesLayer?.draw(pass);
          },
        },
      ],
    };
  }

  private dispatchBin(): void {
    if (!this.binsBuffer || !this.binPipeline || !this.activeData) return;
    this.binsBuffer.write(this.zeroBins);
    this.maxCountBuffer?.write(new Uint32Array([0]));
    if (this.activeData.count === 0) return;
    this.binPipeline.dispatch(
      this.caps
        ? dispatchWorkgroups(this.caps, this.activeData.count, BIN_WORKGROUP_SIZE, {
            warnings: this.warnings ?? undefined,
            source: "histogram-bin",
          })
        : Math.ceil(this.activeData.count / BIN_WORKGROUP_SIZE),
    );
  }

  private dispatchReduceMax(): void {
    if (!this.reducePipeline || !this.activeData) return;
    this.reducePipeline.dispatch(
      this.caps
        ? dispatchWorkgroups(this.caps, this.activeData.binCount, REDUCE_MAX_WORKGROUP_SIZE, {
            warnings: this.warnings ?? undefined,
            source: "histogram-reduce-max",
          })
        : Math.ceil(this.activeData.binCount / REDUCE_MAX_WORKGROUP_SIZE),
    );
  }

  dispose(): void {
    this.barLayer?.dispose();
    this.rulesLayer?.dispose();
  }
}
