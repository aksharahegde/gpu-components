import { assertBufferBudget, InstancedQuadLayer, pixelXToTime, viewportUniforms } from "@gpuc/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpuc/core";
import { storage, uniforms } from "vgpu";
import type { Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { packPoints, POINT_STRIDE, type ScatterData } from "./ingest.ts";
import { buildSpatialIndex, nearestPoint, type SpatialIndex } from "./spatialIndex.ts";
import { SCATTER_WGSL } from "./scatter.wgsl.ts";

export interface ScatterProps {
  readonly data: ScatterData;
  /** x on `timeStart`/`timeEnd`, y on `rowStart`/`rowEnd` — both continuous, both zoomable. */
  readonly viewport: ViewportState;
  readonly pointSizePx?: number;
  /** 1-based category to show alone; 0 or undefined shows everything. A uniform write, not a
   * buffer rebuild — filtering millions of points costs 4 bytes. */
  readonly categoryFilter?: number;
  readonly hoveredIndex?: number | null;
  readonly opacity?: number;
}

interface ScatterUniforms extends Record<string, unknown> {
  readonly pointSizePx: number;
  readonly categoryFilter: number;
  readonly hoveredIndex: number;
  readonly opacity: number;
}

const DEFAULT_POINT_PX = 4;
/** Hover radius in pixels — generous enough to grab a 4px disc without feeling sticky. */
const HOVER_RADIUS_PX = 8;

let nextId = 0;

/**
 * `GPUScatter` — PLAN.md §6.2's second-ranked candidate (136.0) and the only one scoring a perfect
 * 10 on demonstrable performance delta.
 *
 * The purest expression of the runtime's case: one `InstancedQuadLayer`, one draw call, N points,
 * and the CPU touches none of them after upload. Pan, zoom, recolour, and *filter by category* are
 * all uniform writes over an immutable buffer — §5's gate 3 with nothing in the way. There is no
 * text budget, no grid semantics and no LOD subtlety obscuring the comparison, which is exactly why
 * it is the clearest demo this project can build.
 *
 * **It also settles an open question in `core`'s favour, against the plan's own text.** §9.5 routes
 * dense scatter to asynchronous GPU ID-buffer picking because it supposedly "has no cheap CPU
 * index". It has one: see `spatialIndex.ts`. Hover here is exact and same-frame, not a readback and
 * a frame late. The `Picker` subsystem §9.5 reserves for this case remains unbuilt, and the honest
 * conclusion is that a *graph* — where positions move every frame — is the component that should
 * justify building it.
 */
export class ScatterComponent implements GpuComponent<ScatterProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private layer: InstancedQuadLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private paramsUniform: SharedUniforms<ScatterUniforms> | null = null;
  private selectionMask: StorageBuffer | null = null;
  private selectionWords = 0;

  private uploadedData: ScatterData | null = null;
  private index: SpatialIndex | null = null;
  private currentViewport: ViewportState | null = null;
  /** A plain field rather than a parameter property: Node's strip-only TypeScript mode, which this
   * repo's tests run under, does not support parameter properties. */
  private readonly initialCapacity: number;

  constructor(initialCapacity = 1024) {
    this.initialCapacity = initialCapacity;
    this.id = `scatter-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;
    this.layer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: SCATTER_WGSL,
      instanceStride: POINT_STRIDE,
      capacity: Math.max(this.initialCapacity, this.uploadedData?.count ?? 1),
      label: this.id,
      warnings: ctx.runtime.warnings,
    });

    this.viewportUniform = uniforms(ctx.gpu!, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.paramsUniform = uniforms(ctx.gpu!, {
      pointSizePx: DEFAULT_POINT_PX,
      categoryFilter: 0,
      hoveredIndex: -1,
      opacity: 1,
    });
    this.layer.bindViewport(this.viewportUniform);
    this.layer.bind({ params: this.paramsUniform });

    this.selectionWords = 0;
    this.ensureSelectionMask(this.uploadedData?.count ?? 1);

    // Re-upload after a device-loss replay from the CPU-side source of truth (§10.6).
    if (this.uploadedData) this.uploadPoints(this.uploadedData);
    if (this.currentViewport) this.writeViewport(this.currentViewport);
  }

  private ensureSelectionMask(count: number): void {
    if (!this.gpu) return;
    const words = Math.max(1, Math.ceil(count / 32));
    if (words <= this.selectionWords) return;
    this.selectionWords = words;
    this.selectionMask = storage(this.gpu, words * 4, "read-write");
    this.selectionMask.write(new Uint32Array(words));
    this.layer?.bind({ selectionMask: this.selectionMask });
  }

  private uploadPoints(data: ScatterData): void {
    if (this.caps) assertBufferBudget(this.caps, data.count * POINT_STRIDE, "GPUScatter points", POINT_STRIDE);
    this.ensureSelectionMask(data.count);
    this.layer?.upload(packPoints(data), data.count);
  }

  private writeViewport(viewport: ViewportState): void {
    this.viewportUniform?.set(viewportUniforms(viewport));
  }

  update(props: ScatterProps): void {
    if (props.data !== this.uploadedData) {
      this.uploadedData = props.data;
      // Built once per dataset, not per frame — the property that makes CPU picking viable here.
      this.index = buildSpatialIndex(props.data);
      this.uploadPoints(props.data);
    }
    this.currentViewport = props.viewport;
    this.writeViewport(props.viewport);
    this.paramsUniform?.set({
      pointSizePx: props.pointSizePx ?? DEFAULT_POINT_PX,
      categoryFilter: props.categoryFilter ?? 0,
      hoveredIndex: props.hoveredIndex ?? -1,
      opacity: props.opacity ?? 1,
    });
    this.dirty = true;
  }

  /**
   * Exact, same-frame hover through the uniform grid (§9.5's "CPU by default", applied where the
   * plan said it could not be). The pixel radius is converted to data units per axis, so the hit
   * area stays circular on screen no matter how far the two axes have been zoomed apart.
   */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    const data = this.uploadedData;
    const index = this.index;
    if (!viewport || !data || !index) return null;

    const dataX = pixelXToTime(viewport, x);
    const rowStart = viewport.rowStart ?? 0;
    const rowEnd = viewport.rowEnd ?? viewport.trackCount;
    // y is inverted: pixel 0 is the top, which is the *maximum* data y.
    const dataY = rowEnd - (y / Math.max(viewport.height, 1)) * (rowEnd - rowStart);

    const unitsPerPxX = (viewport.timeEnd - viewport.timeStart) / Math.max(viewport.width, 1);
    const unitsPerPxY = (rowEnd - rowStart) / Math.max(viewport.height, 1);
    const radius = HOVER_RADIUS_PX * Math.max(unitsPerPxX, unitsPerPxY);

    const found = nearestPoint(index, data, dataX, dataY, radius);
    return found == null ? null : { id: found };
  }

  /** The spatial index, for a wrapper that wants brush selection without rebuilding it. */
  get spatialIndex(): SpatialIndex | null {
    return this.index;
  }

  /** Marks `indices` selected in the GPU bitset — one bit per point, read by the render shader
   * (§9.5's hybrid model: CPU computes the region, the GPU renders the mask). */
  setSelection(indices: readonly number[]): void {
    if (!this.selectionMask || !this.uploadedData) return;
    const words = new Uint32Array(this.selectionWords);
    for (const i of indices) {
      if (i < 0 || i >= this.uploadedData.count) continue;
      words[i >>> 5]! |= 1 << (i & 31);
    }
    this.selectionMask.write(words);
    this.dirty = true;
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedData || !this.currentViewport) return { computePasses: [], renderPasses: [] };
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "scatter",
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
