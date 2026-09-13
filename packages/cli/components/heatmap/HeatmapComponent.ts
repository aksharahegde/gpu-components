import { assertBufferBudget, dispatchWorkgroups, RasterLayer, rowRange, viewportUniforms, visibleRows } from "@gpuc/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpuc/core";
import { compute, storage, uniforms } from "vgpu";
import type { Compute, Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { computeRange, VALUE_STRIDE, type HeatmapData } from "./ingest.ts";
import { buildColormapLut, colormapKey, LUT_SIZE, type ColormapName } from "./colormap.ts";
import { HEATMAP_WGSL } from "./heatmap.wgsl.ts";
import { REDUCE_CHUNK_WGSL, REDUCE_FINAL_WGSL, REDUCE_WORKGROUP_SIZE } from "./reduce.wgsl.ts";

export interface HeatmapProps {
  readonly data: HeatmapData;
  /** Column domain on x, row domain on y. See this file's doc comment on the naming. */
  readonly viewport: ViewportState;
  readonly colormap?: ColormapName;
}

interface GridUniforms extends Record<string, unknown> {
  readonly rows: number;
  readonly cols: number;
  readonly sampleX: number;
  readonly sampleY: number;
}

interface ReduceUniforms extends Record<string, unknown> {
  readonly count: number;
  readonly chunkCount: number;
}

/** Bounds the per-pixel aggregation loop in `heatmap.wgsl.ts`. A pixel covering more cells than
 * this samples a representative sub-block rather than all of them — bounded work per pixel is the
 * point, and PLAN.md §24.2 requires the clamp to be computed CPU-side and asserted, never derived
 * from data inside the kernel. */
const SAMPLE_CAP = 8;
/** Ceiling on pass-1 workgroups, so pass 2's single-threaded fold stays short regardless of matrix
 * size. 256 chunks x 256 lanes covers 65,536 values per grid-stride step. */
const MAX_CHUNKS = 256;

let nextId = 0;

/**
 * `GPUHeatmap` — PLAN.md §29 Phase 5's **architecture test**, whose acceptance criterion is a
 * falsifiable claim: this component should require *zero* changes to `@gpuc/core`.
 *
 * Stages 1–3 (data model, raster render, compute in the data path) are implemented here. What core
 * carried unchanged: `RasterLayer`, `viewportUniforms()`, `ResourceRegistry` (the colormap LUT is
 * its first production consumer anywhere in the repo), the scheduler's compute-before-render
 * ordering, the warnings log, and device-loss replay via re-upload in `create()`.
 *
 * **Where core did not fit, recorded rather than worked around** — see `CORE-WISHLIST.md` for the
 * full list and the evidence. The short version: `ViewportState` is timeline-shaped. Its fields are
 * `timeStart`/`timeEnd`/`trackCount`, its y mapping is derived from a row *count* with no pan or
 * zoom of its own, and `ViewportController` is x-only. A heatmap has two continuous axes. This
 * component works today only because stages 1–3 do not zoom vertically; the moment interaction
 * lands (stage 5), the model has to grow a y axis.
 */
export class HeatmapComponent implements GpuComponent<HeatmapProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private warnings: ComponentContext["runtime"]["warnings"] | null = null;
  private raster: RasterLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private gridUniform: SharedUniforms<GridUniforms> | null = null;
  private reduceParams: SharedUniforms<ReduceUniforms> | null = null;

  private valuesBuffer: StorageBuffer | null = null;
  private partialsBuffer: StorageBuffer | null = null;
  private rangeBuffer: StorageBuffer | null = null;
  private lutBuffer: StorageBuffer | null = null;
  private reduceChunk: Compute | null = null;
  private reduceFinal: Compute | null = null;

  private valueCapacity = 0;
  private chunkCount = 1;
  /** Registry key of the LUT currently held, so `dispose()` releases exactly what it acquired. */
  private lutKey: string | null = null;
  private registry: ComponentContext["registry"] | null = null;

  private uploadedData: HeatmapData | null = null;
  private currentViewport: ViewportState | null = null;
  private currentColormap: ColormapName = "viridis";
  /** The range reduction only needs to re-run when the *data* changes — panning does not alter a
   * matrix's min/max. Gating it is the scheduler-dirty discipline of PLAN.md §10.2 applied to a
   * compute pass rather than a draw. */
  private rangeDirty = true;

  constructor() {
    this.id = `heatmap-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;
    this.warnings = ctx.runtime.warnings;
    this.registry = ctx.registry;

    this.raster = new RasterLayer({
      gpu: ctx.gpu,
      shader: HEATMAP_WGSL,
      label: `${this.id}-raster`,
      // PLAN.md §22.2's `RasterLayer` row — "`putImageData` of a CPU-binned density field". The
      // colour decision is the component's (core knows only that there is a buffer), so the CPU
      // path re-implements the fragment shader's mapping rather than sharing it. Kept deliberately
      // simple: nearest-cell sampling, no per-pixel aggregation, which is the documented
      // "degraded but correct" contract rather than parity.
      fallback: { shade: (rgba, width, height) => this.shadeCanvas2D(rgba, width, height) },
    });

    this.viewportUniform = uniforms(ctx.gpu!, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.gridUniform = uniforms(ctx.gpu!, { rows: 1, cols: 1, sampleX: 1, sampleY: 1 });
    this.reduceParams = uniforms(ctx.gpu!, { count: 0, chunkCount: 1 });

    this.reduceChunk = compute(ctx.gpu!, REDUCE_CHUNK_WGSL);
    this.reduceFinal = compute(ctx.gpu!, REDUCE_FINAL_WGSL);

    // `range` is two f32s the render shader reads and pass 2 writes — never read back on the CPU.
    this.rangeBuffer = storage(ctx.gpu!, 2 * 4, "read-write");
    this.partialsBuffer = storage(ctx.gpu!, MAX_CHUNKS * 2 * 4, "read-write");

    // The colormap LUT through the shared registry: content-keyed, so a second heatmap with the
    // same ramp reuses this exact buffer instead of allocating its own (PLAN.md §14.1a).
    this.acquireLut(this.currentColormap);

    this.reduceChunk.set({ params: this.reduceParams, partials: this.partialsBuffer });
    this.reduceFinal.set({
      params: this.reduceParams,
      partials: this.partialsBuffer,
      range: this.rangeBuffer,
    });
    this.raster.bind({
      viewport: this.viewportUniform,
      grid: this.gridUniform,
      range: this.rangeBuffer,
      lut: this.lutBuffer,
    });

    // Fresh GPU state after a device-loss replay: re-upload from the CPU-side source of truth and
    // recompute the range (PLAN.md §10.6/§14.2 — every buffer regenerable, no GPU state trusted).
    // A one-element placeholder so `values` is *always* bound, even before any data arrives.
    //
    // Without this the component is unbindable between `create()` and the first `update()`, and the
    // scheduler can tick in that window — `useGpuComponent` mounts in one effect and updates in
    // another, and a rAF can land between them. vgpu then throws
    // `Unset values @group(0) @binding(2)` at encode time. PLAN.md §14.2's "lazy allocation: a
    // mounted-but-empty component costs one bind group" is exactly this: allocate something
    // minimal, not nothing.
    this.valueCapacity = 0;
    this.allocValues(this.uploadedData?.values.length ?? 1);
    if (this.uploadedData) {
      this.uploadValues(this.uploadedData);
      this.rangeDirty = true;
    }
    if (this.currentViewport) this.writeViewport(this.currentViewport, this.uploadedData);
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
    this.raster?.bind({ lut: this.lutBuffer });
  }

  /** Allocates the value buffer and binds it everywhere it is read. */
  private allocValues(count: number): void {
    if (!this.gpu) return;
    if (this.caps) assertBufferBudget(this.caps, count * VALUE_STRIDE, "GPUHeatmap values", VALUE_STRIDE);
    this.valueCapacity = Math.max(1, count);
    this.valuesBuffer = storage(this.gpu, this.valueCapacity * VALUE_STRIDE, "read");
    this.reduceChunk?.set({ values: this.valuesBuffer });
    this.raster?.bind({ values: this.valuesBuffer });
  }

  /** Grows the value buffer on demand, then writes the matrix. */
  private uploadValues(data: HeatmapData): void {
    if (!this.gpu) return;
    const count = data.values.length;
    if (count > this.valueCapacity) {
      this.allocValues(count);
    }
    this.valuesBuffer?.write(data.values);

    this.chunkCount = Math.max(
      1,
      Math.min(MAX_CHUNKS, Math.ceil(count / REDUCE_WORKGROUP_SIZE)),
    );
    this.reduceParams?.set({ count, chunkCount: this.chunkCount });
  }

  /**
   * Writes the viewport uniform, and with it the per-pixel sampling budget.
   *
   * The column/row extents come straight from `core`'s `viewportUniforms()` — the same scale/offset
   * pair the Timeline uses, reinterpreted. `sampleX`/`sampleY` are how many cells one pixel covers,
   * clamped to `SAMPLE_CAP`: this is the heatmap's LOD decision, made on the CPU from the viewport
   * alone, with no GPU readback (the same shape as `TimelineComponent.estimateLodMode`).
   */
  private writeViewport(viewport: ViewportState, data: HeatmapData | null): void {
    const uniformsValue = viewportUniforms(viewport);
    this.viewportUniform?.set(uniformsValue);

    if (!data) return;
    const visibleCols = Math.max(viewport.timeEnd - viewport.timeStart, 1e-9);
    const colsPerPixel = visibleCols / Math.max(viewport.width, 1);
    // visibleRows(), not data.rows: once the y axis scrolls, the number of rows on screen is no
    // longer the number of rows in the dataset, and using the latter would over-sample by the
    // zoom factor — drawing a blurred average where the user asked for detail.
    const rowsPerPixel = visibleRows(viewport) / Math.max(viewport.height, 1);
    this.gridUniform?.set({
      rows: data.rows,
      cols: data.cols,
      sampleX: Math.max(1, Math.min(SAMPLE_CAP, Math.ceil(colsPerPixel))),
      sampleY: Math.max(1, Math.min(SAMPLE_CAP, Math.ceil(rowsPerPixel))),
    });
  }

  update(props: HeatmapProps): void {
    const colormap = props.colormap ?? "viridis";
    if (colormap !== this.currentColormap) {
      this.currentColormap = colormap;
      this.acquireLut(colormap);
    }

    if (props.data !== this.uploadedData) {
      this.uploadValues(props.data);
      this.uploadedData = props.data;
      this.rangeDirty = true;
    }

    this.currentViewport = props.viewport;
    this.writeViewport(props.viewport, props.data);
    this.dirty = true;
  }

  /** Cell hit-testing is arithmetic, not search — a matrix cell's position *is* its index. No
   * spatial index, and no GPU picking (PLAN.md §9.5: CPU by default, exact and immediate). */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    const data = this.uploadedData;
    if (!viewport || !data) return null;

    const visibleCols = viewport.timeEnd - viewport.timeStart;
    const col = Math.floor(viewport.timeStart + (x / Math.max(viewport.width, 1)) * visibleCols);
    const [rowStart, rowEnd] = rowRange(viewport);
    const row = Math.floor(rowStart + (y / Math.max(viewport.height, 1)) * (rowEnd - rowStart));
    if (col < 0 || row < 0 || col >= data.cols || row >= data.rows) return null;
    return { id: row * data.cols + col };
  }

  plan(): RenderPlan {
    this.dirty = false;
    // Nothing uploaded yet: contribute no passes at all rather than drawing a placeholder buffer
    // (PLAN.md §10.2 — a component with nothing to say costs nothing). Belt and braces with the
    // placeholder allocation in `create()`: that keeps the bindings valid, this keeps the frame
    // empty until there is real data.
    if (!this.uploadedData || !this.currentViewport) return { computePasses: [], renderPasses: [] };
    const computePasses = this.rangeDirty
      ? [
          { name: "heatmap-reduce-chunk", dispatch: () => this.dispatchReduceChunk() },
          { name: "heatmap-reduce-final", dispatch: () => this.dispatchReduceFinal() },
        ]
      : [];
    this.rangeDirty = false;

    return {
      computePasses,
      renderPasses: [
        {
          name: "heatmap",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.raster?.draw(pass);
          },
        },
      ],
    };
  }

  private dispatchReduceChunk(): void {
    if (!this.reduceChunk || !this.uploadedData || this.uploadedData.values.length === 0) return;
    // chunkCount is already bounded by MAX_CHUNKS, but clamp anyway: the bound is ours and the
    // limit is the device's, and only one of those is guaranteed to be the smaller.
    this.reduceChunk.dispatch(
      this.caps
        ? dispatchWorkgroups(this.caps, this.chunkCount * REDUCE_WORKGROUP_SIZE, REDUCE_WORKGROUP_SIZE, {
            warnings: this.warnings ?? undefined,
            source: "heatmap-reduce-chunk",
          })
        : this.chunkCount,
    );
  }

  private dispatchReduceFinal(): void {
    if (!this.reduceFinal || !this.uploadedData || this.uploadedData.values.length === 0) return;
    this.reduceFinal.dispatch(1);
  }

  /**
   * The Canvas2D fallback's pixel loop (PLAN.md §22). Mirrors `heatmap.wgsl.ts`'s mapping on the
   * CPU: pixel → clip → cell → normalised value → LUT. Uses `computeRange()` rather than the GPU
   * `range` buffer, because in fallback mode no dispatch ran to fill it — §22.2's "compute passes →
   * CPU equivalents" row, at the smallest possible scale.
   */
  private shadeCanvas2D(rgba: Uint8ClampedArray, width: number, height: number): void {
    const data = this.uploadedData;
    const viewport = this.currentViewport;
    if (!data || !viewport) {
      rgba.fill(0);
      return;
    }
    const lut = buildColormapLut(this.currentColormap);
    const [lo, hi] = computeRange(data);
    const span = Math.max(hi - lo, 1e-20);
    const visibleCols = viewport.timeEnd - viewport.timeStart;
    const [rowStart, rowEnd] = rowRange(viewport);
    const visibleRowSpan = rowEnd - rowStart;

    for (let py = 0; py < height; py++) {
      const row = Math.floor(rowStart + ((py + 0.5) / height) * visibleRowSpan);
      for (let px = 0; px < width; px++) {
        const col = Math.floor(viewport.timeStart + ((px + 0.5) / width) * visibleCols);
        const at = (py * width + px) * 4;
        if (row < 0 || col < 0 || row >= data.rows || col >= data.cols) {
          rgba[at + 3] = 0;
          continue;
        }
        const value = data.values[row * data.cols + col]!;
        if (!Number.isFinite(value)) {
          rgba[at + 3] = 0;
          continue;
        }
        const t = Math.max(0, Math.min(1, (value - lo) / span));
        const entry = Math.round(t * (LUT_SIZE - 1)) * 4;
        rgba[at + 0] = lut[entry]! * 255;
        rgba[at + 1] = lut[entry + 1]! * 255;
        rgba[at + 2] = lut[entry + 2]! * 255;
        rgba[at + 3] = 255;
      }
    }
  }

  /** CPU range, for the Canvas2D fallback and for tests to check the GPU reduction against. */
  cpuRange(): readonly [number, number] {
    return this.uploadedData ? computeRange(this.uploadedData) : [0, 1];
  }

  dispose(): void {
    this.raster?.dispose();
    // Ref-counted: the LUT survives if another component still holds it (PLAN.md §14.2).
    if (this.lutKey) this.registry?.release(this.lutKey);
    this.lutKey = null;
    this.lutBuffer = null;
  }
}
