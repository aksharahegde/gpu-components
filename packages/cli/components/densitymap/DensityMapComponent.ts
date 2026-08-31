import {
  assertBufferBudget,
  dispatchWorkgroups,
  InstancedQuadLayer,
  LineLayer,
  pixelXToTime,
  pixelYToTrack,
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
import { packPoints, POINT_STRIDE, type DensityMapData } from "./ingest.ts";
import { buildColormapLut, colormapKey, LUT_SIZE, type ColormapName } from "./colormap.ts";
import { HEXBIN_WGSL, HEXBIN_WORKGROUP_SIZE } from "./hexbin.wgsl.ts";
import { HEX_INSTANCE_STRIDE, HEX_WGSL } from "./hex.wgsl.ts";
import { REDUCE_MAX_WGSL, REDUCE_MAX_WORKGROUP_SIZE } from "./reduce.wgsl.ts";
import {
  layoutHexGrid,
  hexSizeFromViewportPx,
  offsetIndex,
  pixelToOffset,
  type HexGridLayout,
  MAX_HEXES,
  DEFAULT_HEX_SIZE_PX,
} from "./hexmath.ts";
import { computeGraticule, MAX_GRATICULE } from "./graticule.ts";
import { MAX_WORLD_OUTLINE, WORLD_OUTLINE_LINES } from "./worldOutline.ts";

export interface DensityMapProps {
  readonly data: DensityMapData;
  readonly viewport: ViewportState;
  /**
   * Hex size in projected metres. When omitted, size is derived from `hexSizePx` so cells stay
   * readable across zoom levels. Raised further if the viewport would exceed `MAX_HEXES`.
   */
  readonly hexSize?: number;
  /** Target hex width in CSS pixels used when `hexSize` is omitted. Default 14. */
  readonly hexSizePx?: number;
  readonly colormap?: ColormapName;
  readonly hoveredIndex?: number | null;
  readonly opacity?: number;
}

interface BinUniforms extends Record<string, unknown> {
  readonly hexSize: number;
  readonly minCol: number;
  readonly minRow: number;
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  readonly _pad0: number;
  readonly _pad1: number;
}

interface DrawUniforms extends Record<string, unknown> {
  readonly hexSize: number;
  readonly minCol: number;
  readonly minRow: number;
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  readonly hoveredIndex: number;
  readonly opacity: number;
}

interface ReduceUniforms extends Record<string, unknown> {
  readonly cellCount: number;
}

let nextId = 0;

/**
 * `GPUDensityMap` — lon/lat points hexbinned on the GPU into a viewport-covering odd-r grid,
 * coloured with a shared colormap LUT, with graticule + illustrative world-outline chrome.
 *
 * Architecture test against `core`: `InstancedQuadLayer`, `LineLayer`, `viewportUniforms`,
 * `ResourceRegistry`, and scheduler compute-before-render — no core changes intended.
 */
export class DensityMapComponent implements GpuComponent<DensityMapProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private warnings: ComponentContext["runtime"]["warnings"] | null = null;
  private registry: ComponentContext["registry"] | null = null;

  private hexLayer: InstancedQuadLayer | null = null;
  private chromeLayer: LineLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private binParams: SharedUniforms<BinUniforms> | null = null;
  private drawParams: SharedUniforms<DrawUniforms> | null = null;
  private reduceParams: SharedUniforms<ReduceUniforms> | null = null;

  private pointsBuffer: StorageBuffer | null = null;
  private densityBuffer: StorageBuffer | null = null;
  private maxCountBuffer: StorageBuffer | null = null;
  private lutBuffer: StorageBuffer | null = null;
  private hexbinPipeline: Compute | null = null;
  private reducePipeline: Compute | null = null;

  private pointCapacity = 0;
  private cellCapacity = 0;
  private zeroDensity: Uint32Array<ArrayBuffer> = new Uint32Array(new ArrayBuffer(0));
  private hexPlaceholder: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  private lutKey: string | null = null;

  private uploadedData: DensityMapData | null = null;
  private currentViewport: ViewportState | null = null;
  private currentLayout: HexGridLayout | null = null;
  /** Explicit projected metres when the caller set `hexSize`; otherwise null → derive from px. */
  private requestedHexSizeM: number | null = null;
  private requestedHexSizePx = DEFAULT_HEX_SIZE_PX;
  private currentColormap: ColormapName = "viridis";
  private hoveredIndex = -1;
  private opacity = 0.85;
  private densityDirty = true;

  constructor() {
    this.id = `densitymap-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;
    this.warnings = ctx.runtime.warnings;
    this.registry = ctx.registry;

    this.hexLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: HEX_WGSL,
      instanceStride: HEX_INSTANCE_STRIDE,
      capacity: MAX_HEXES,
      label: `${this.id}-hex`,
      warnings: ctx.runtime.warnings,
    });

    this.chromeLayer = new LineLayer({
      gpu: ctx.gpu,
      capacity: MAX_GRATICULE + MAX_WORLD_OUTLINE,
      label: `${this.id}-chrome`,
      warnings: ctx.runtime.warnings,
    });

    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.binParams = uniforms(ctx.gpu, {
      hexSize: 1,
      minCol: 0,
      minRow: 0,
      cols: 1,
      rows: 1,
      count: 0,
      _pad0: 0,
      _pad1: 0,
    });
    this.drawParams = uniforms(ctx.gpu, {
      hexSize: 1,
      minCol: 0,
      minRow: 0,
      cols: 1,
      rows: 1,
      count: 0,
      hoveredIndex: -1,
      opacity: 0.85,
    });
    this.reduceParams = uniforms(ctx.gpu, { cellCount: 1 });

    this.hexbinPipeline = compute(ctx.gpu, HEXBIN_WGSL);
    this.reducePipeline = compute(ctx.gpu, REDUCE_MAX_WGSL);
    this.maxCountBuffer = storage(ctx.gpu, 4, "read-write");

    this.acquireLut(this.currentColormap);

    this.hexLayer.bindViewport(this.viewportUniform);
    this.chromeLayer.bindViewport(this.viewportUniform);
    this.hexLayer.bind({
      params: this.drawParams,
      maxCount: this.maxCountBuffer,
      lut: this.lutBuffer,
    });
    this.hexbinPipeline.set({ params: this.binParams });
    this.reducePipeline.set({ params: this.reduceParams, maxCount: this.maxCountBuffer });

    this.ensurePointCapacity(this.uploadedData?.count ?? 1);
    this.ensureCellCapacity(1);

    if (this.uploadedData) this.uploadPoints(this.uploadedData);
    if (this.currentViewport) {
      this.writeViewport(this.currentViewport);
      this.syncLayout(this.currentViewport);
      this.uploadChrome(this.currentViewport);
    }
  }

  private acquireLut(name: ColormapName): void {
    if (!this.gpu || !this.registry) return;
    const key = colormapKey(name);
    if (this.lutKey === key && this.lutBuffer) return;
    if (this.lutKey) this.registry.release(this.lutKey);

    this.lutBuffer = this.registry.acquire(key, () => {
      const buffer = storage(this.gpu!, LUT_SIZE * 4 * 4, "read");
      buffer.write(buildColormapLut(name));
      return buffer;
    });
    this.lutKey = key;
    this.hexLayer?.bind({ lut: this.lutBuffer });
  }

  private ensurePointCapacity(count: number): void {
    if (!this.gpu || count <= this.pointCapacity) return;
    if (this.caps) assertBufferBudget(this.caps, count * POINT_STRIDE, "GPUDensityMap points", POINT_STRIDE);
    this.pointCapacity = Math.max(1, count);
    this.pointsBuffer = storage(this.gpu, this.pointCapacity * POINT_STRIDE, "read");
    this.hexbinPipeline?.set({ points: this.pointsBuffer });
  }

  private ensureCellCapacity(cellCount: number): void {
    if (!this.gpu) return;
    const n = Math.max(1, cellCount);
    if (n <= this.cellCapacity && this.densityBuffer) return;
    this.cellCapacity = n;
    this.densityBuffer = storage(this.gpu, this.cellCapacity * 4, "read-write");
    this.zeroDensity = new Uint32Array(new ArrayBuffer(this.cellCapacity * 4));
    this.hexPlaceholder = new Uint8Array(new ArrayBuffer(this.cellCapacity * HEX_INSTANCE_STRIDE));
    this.hexbinPipeline?.set({ density: this.densityBuffer });
    this.reducePipeline?.set({ density: this.densityBuffer });
    this.hexLayer?.bind({ density: this.densityBuffer });
  }

  private uploadPoints(data: DensityMapData): void {
    this.ensurePointCapacity(data.count);
    this.pointsBuffer?.write(packPoints(data));
  }

  private writeViewport(viewport: ViewportState): void {
    this.viewportUniform?.set(viewportUniforms(viewport));
  }

  private resolveHexSizeM(viewport: ViewportState): number {
    if (this.requestedHexSizeM != null) return this.requestedHexSizeM;
    return hexSizeFromViewportPx(viewport, this.requestedHexSizePx);
  }

  private syncLayout(viewport: ViewportState): void {
    const layout = layoutHexGrid(viewport, this.resolveHexSizeM(viewport), MAX_HEXES);
    this.currentLayout = layout;
    this.ensureCellCapacity(layout.cellCount);
    this.hexLayer?.upload(this.hexPlaceholder, layout.cellCount);

    this.binParams?.set({
      hexSize: layout.hexSize,
      minCol: layout.minCol,
      minRow: layout.minRow,
      cols: layout.cols,
      rows: layout.rows,
      count: this.uploadedData?.count ?? 0,
      _pad0: 0,
      _pad1: 0,
    });
    this.drawParams?.set({
      hexSize: layout.hexSize,
      minCol: layout.minCol,
      minRow: layout.minRow,
      cols: layout.cols,
      rows: layout.rows,
      count: this.uploadedData?.count ?? 0,
      hoveredIndex: this.hoveredIndex,
      opacity: this.opacity,
    });
    this.reduceParams?.set({ cellCount: layout.cellCount });
    this.densityDirty = true;
  }

  private uploadChrome(viewport: ViewportState): void {
    const graticule = computeGraticule(viewport);
    this.chromeLayer?.uploadLines([...WORLD_OUTLINE_LINES, ...graticule]);
  }

  update(props: DensityMapProps): void {
    const colormap = props.colormap ?? "viridis";
    if (colormap !== this.currentColormap) {
      this.currentColormap = colormap;
      this.acquireLut(colormap);
    }

    this.hoveredIndex = props.hoveredIndex ?? -1;
    this.opacity = props.opacity ?? 0.85;
    this.requestedHexSizeM = props.hexSize ?? null;
    this.requestedHexSizePx = props.hexSizePx ?? DEFAULT_HEX_SIZE_PX;

    if (props.data !== this.uploadedData) {
      this.uploadedData = props.data;
      this.uploadPoints(props.data);
      this.densityDirty = true;
    }

    this.currentViewport = props.viewport;
    this.writeViewport(props.viewport);
    this.syncLayout(props.viewport);
    this.uploadChrome(props.viewport);

    this.drawParams?.set({
      hexSize: this.currentLayout?.hexSize ?? 1,
      minCol: this.currentLayout?.minCol ?? 0,
      minRow: this.currentLayout?.minRow ?? 0,
      cols: this.currentLayout?.cols ?? 1,
      rows: this.currentLayout?.rows ?? 1,
      count: this.uploadedData?.count ?? 0,
      hoveredIndex: this.hoveredIndex,
      opacity: this.opacity,
    });

    this.dirty = true;
  }

  /** Hex cell under the cursor via odd-r math — exact, same-frame, no GPU pick. */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    const layout = this.currentLayout;
    if (!viewport || !layout) return null;

    const dataX = pixelXToTime(viewport, x);
    const dataY = pixelYToTrack(viewport, y);
    const offset = pixelToOffset(dataX, dataY, layout.hexSize);
    const index = offsetIndex(layout, offset);
    return index < 0 ? null : { id: index };
  }

  /** Active hex layout — for demos / tests that want cell centres. */
  get layout(): HexGridLayout | null {
    return this.currentLayout;
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedData || !this.currentViewport || !this.currentLayout) {
      return { computePasses: [], renderPasses: [] };
    }

    const computePasses = this.densityDirty
      ? [
          { name: "densitymap-hexbin", dispatch: () => this.dispatchHexbin() },
          { name: "densitymap-reduce-max", dispatch: () => this.dispatchReduceMax() },
        ]
      : [];
    this.densityDirty = false;

    return {
      computePasses,
      renderPasses: [
        {
          name: "densitymap",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.hexLayer?.draw(pass);
            this.chromeLayer?.draw(pass);
          },
        },
      ],
    };
  }

  private dispatchHexbin(): void {
    if (!this.densityBuffer || !this.hexbinPipeline || !this.uploadedData || !this.currentLayout) return;
    this.densityBuffer.write(this.zeroDensity);
    this.maxCountBuffer?.write(new Uint32Array([0]));
    if (this.uploadedData.count === 0) return;
    this.hexbinPipeline.dispatch(
      this.caps
        ? dispatchWorkgroups(this.caps, this.uploadedData.count, HEXBIN_WORKGROUP_SIZE, {
            warnings: this.warnings ?? undefined,
            source: "densitymap-hexbin",
          })
        : Math.ceil(this.uploadedData.count / HEXBIN_WORKGROUP_SIZE),
    );
  }

  private dispatchReduceMax(): void {
    if (!this.reducePipeline || !this.currentLayout) return;
    this.reducePipeline.dispatch(
      this.caps
        ? dispatchWorkgroups(this.caps, this.currentLayout.cellCount, REDUCE_MAX_WORKGROUP_SIZE, {
            warnings: this.warnings ?? undefined,
            source: "densitymap-reduce-max",
          })
        : Math.ceil(this.currentLayout.cellCount / REDUCE_MAX_WORKGROUP_SIZE),
    );
  }

  dispose(): void {
    this.hexLayer?.dispose();
    this.chromeLayer?.dispose();
    if (this.lutKey) this.registry?.release(this.lutKey);
    this.lutKey = null;
    this.lutBuffer = null;
  }
}
