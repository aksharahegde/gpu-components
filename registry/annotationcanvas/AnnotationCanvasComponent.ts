import {
  assertBufferBudget,
  InstancedQuadLayer,
  LineLayer,
  packRgba8,
  pixelXToTime,
  pixelYToTrack,
  RasterLayer,
  viewportUniforms,
} from "@gpu-components/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  LineInstance,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpu-components/core";
import { storage, uniforms } from "vgpu";
import type { Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { buildColormapLut, colormapKey, LUT_SIZE, type ColormapName } from "../heatmap/colormap.ts";
import { VALUE_STRIDE, type FieldData } from "./ingest.ts";
import { createScene, type Annotation, type Scene } from "./scene.ts";
import { MAX_POLYGON_POINTS } from "./tools.ts";
import {
  ANNOTATION_COLOR_SHIFT,
  ANNOTATION_FLAG_SELECTED,
  ANNOTATION_INSTANCE_STRIDE,
  ANNOTATION_KIND_ELLIPSE,
  ANNOTATION_KIND_POINT,
  ANNOTATION_KIND_RECT,
  ANNOTATIONS_WGSL,
} from "./annotations.wgsl.ts";
import { FIELD_WGSL } from "./field.wgsl.ts";

/** `viridis`/`magma`/`cividis` reuse `registry/heatmap`'s LUT builder; `gray` is generated locally
 * since a scientific field's default view is grayscale, not a colour ramp heatmap ships. */
export type AnnotationColormap = ColormapName | "gray";

export interface AnnotationCanvasProps {
  readonly field: FieldData;
  readonly annotations: readonly Annotation[];
  /** x maps image columns, y maps image rows — continuous, like `GPUImageDiff`/`GPUHeatmap`. */
  readonly viewport: ViewportState;
  readonly window?: { readonly min: number; readonly max: number };
  readonly colormap?: AnnotationColormap;
  readonly selectedId?: string | null;
}

interface FieldUniforms extends Record<string, unknown> {
  readonly width: number;
  readonly height: number;
  readonly windowMin: number;
  readonly windowMax: number;
}

interface AnnotationUniforms extends Record<string, unknown> {
  readonly strokeWidthPx: number;
  readonly pointSizePx: number;
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
}

/** Soft cap for `props.annotations.length` — past this, a component keeps working but warns
 * (via `runtime.warnings` when available) rather than throwing, since annotation count is host
 * data the component should degrade gracefully under, unlike the hard `MAX_FIELD_DIM` limit. */
const RECOMMENDED_MAX_ANNOTATIONS = 2000;

const DEFAULT_COLORMAP: AnnotationColormap = "gray";
const STROKE_WIDTH_PX = 2;
const SELECTED_STROKE_WIDTH_PX = 3;
const POINT_SIZE_PX = 8;
const FILL_OPACITY = 0.18;
const STROKE_OPACITY = 0.95;
const INITIAL_QUAD_CAPACITY = 64;
/** Presized to `MAX_POLYGON_POINTS`: a single freehand/polygon draft can grow to that many edges,
 * and growing past an undersized capacity mid-drag is exactly the buffer-growth thrashing
 * `InstancedQuadLayer` warns about (see `packages/core`'s `buffer-growth` warning). */
const INITIAL_LINE_CAPACITY = MAX_POLYGON_POINTS;

/** Matches `ANNOTATIONS_WGSL`'s `PALETTE` array (8 entries) — kept in lockstep by hand since the
 * quad shader bakes its own copy and `LineLayer` colours are packed CPU-side. */
const PALETTE_RGB: readonly (readonly [number, number, number])[] = [
  [59, 211, 232],
  [167, 139, 250],
  [64, 224, 158],
  [251, 191, 36],
  [248, 113, 113],
  [251, 152, 61],
  [96, 165, 250],
  [241, 241, 241],
];

function paletteIndex(color: number | undefined): number {
  const n = color ?? 0;
  return ((n % PALETTE_RGB.length) + PALETTE_RGB.length) % PALETTE_RGB.length;
}

/** Brightens a palette colour toward white — the CPU-side counterpart of `ANNOTATIONS_WGSL`'s
 * `mix(color, vec3f(1.0), 0.45)` selection highlight, for the line-drawn annotation kinds. */
function selectedLineColor(color: number | undefined): number {
  const [r, g, b] = PALETTE_RGB[paletteIndex(color)]!;
  const mix = (c: number) => Math.round(c + (255 - c) * 0.45);
  return packRgba8(mix(r), mix(g), mix(b), 255);
}

function lineColor(color: number | undefined): number {
  const [r, g, b] = PALETTE_RGB[paletteIndex(color)]!;
  return packRgba8(r, g, b, 255);
}

function grayLutKey(): string {
  return `colormap:gray:${LUT_SIZE}`;
}

/** A neutral ramp so a field with no explicit colormap reads as a conventional grayscale scan. */
function buildGrayLut(): Float32Array<ArrayBuffer> {
  const lut = new Float32Array(new ArrayBuffer(LUT_SIZE * 4 * 4));
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    lut[i * 4 + 0] = t;
    lut[i * 4 + 1] = t;
    lut[i * 4 + 2] = t;
    lut[i * 4 + 3] = 1;
  }
  return lut;
}

function writeQuadInstance(
  view: DataView,
  index: number,
  kind: number,
  flags: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const at = index * ANNOTATION_INSTANCE_STRIDE;
  view.setUint32(at + 0, kind, true);
  view.setUint32(at + 4, flags, true);
  view.setFloat32(at + 8, x, true);
  view.setFloat32(at + 12, y, true);
  view.setFloat32(at + 16, w, true);
  view.setFloat32(at + 20, h, true);
  view.setFloat32(at + 24, 0, true);
  view.setFloat32(at + 28, 0, true);
}

/** Rect/ellipse/point map to one quad each — `ANNOTATIONS_WGSL`'s domain. Ruler/polygon/freehand
 * are edges, packed separately for `LineLayer` by `packLineInstances`. */
function packQuadInstances(
  annotations: readonly Annotation[],
  selectedId: string | null,
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly count: number } {
  const quads = annotations.filter(
    (a): a is Annotation & { kind: "rect" | "ellipse" | "point" } =>
      a.kind === "rect" || a.kind === "ellipse" || a.kind === "point",
  );
  const bytes = new Uint8Array(new ArrayBuffer(Math.max(1, quads.length) * ANNOTATION_INSTANCE_STRIDE));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < quads.length; i++) {
    const a = quads[i]!;
    const flags =
      (a.id === selectedId ? ANNOTATION_FLAG_SELECTED : 0) | (paletteIndex(a.color) << ANNOTATION_COLOR_SHIFT);
    if (a.kind === "point") {
      writeQuadInstance(view, i, ANNOTATION_KIND_POINT, flags, a.x, a.y, 0, 0);
    } else if (a.kind === "rect") {
      writeQuadInstance(view, i, ANNOTATION_KIND_RECT, flags, a.x, a.y, a.w, a.h);
    } else {
      writeQuadInstance(view, i, ANNOTATION_KIND_ELLIPSE, flags, a.x, a.y, a.w, a.h);
    }
  }
  return { bytes, count: quads.length };
}

/** Ruler segments and polygon/freehand edges, expanded to one `LineInstance` per segment — the
 * shapes `ANNOTATIONS_WGSL` deliberately does not draw (see that file's header comment). */
function packLineInstances(annotations: readonly Annotation[], selectedId: string | null): LineInstance[] {
  const lines: LineInstance[] = [];
  for (const a of annotations) {
    const selected = a.id === selectedId;
    const widthPx = selected ? SELECTED_STROKE_WIDTH_PX : STROKE_WIDTH_PX;
    const color = selected ? selectedLineColor(a.color) : lineColor(a.color);
    if (a.kind === "ruler") {
      lines.push({ x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1, widthPx, color });
    } else if (a.kind === "polygon") {
      const pts = a.points;
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i]!;
        const p1 = pts[(i + 1) % pts.length]!;
        lines.push({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, widthPx, color });
      }
    } else if (a.kind === "freehand") {
      const pts = a.points;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1]!;
        const p1 = pts[i]!;
        lines.push({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, widthPx, color });
      }
    }
  }
  return lines;
}

let nextId = 0;

/**
 * `GPUAnnotationCanvas`'s GPU component — a Float32 field drawn through `RasterLayer` (the same
 * storage-buffer + colormap shape `GPUHeatmap` proved out) plus a retained annotation overlay: one
 * quad per rect/ellipse/point (`InstancedQuadLayer`) and one line per ruler/polygon/freehand edge
 * (`LineLayer`). Both overlay buffers rebuild only when annotations or the selection change; panning
 * and windowing are uniform writes over unchanged buffers, the same discipline `GPUHeatmap`'s range
 * reduction and `GPUImageDiff`'s stats pass apply to their own once-per-data work.
 *
 * No compute passes and no continuous `animating`: the field needs no GPU reduction (its window
 * comes straight from props or `FieldData.window`), and nothing here moves on its own.
 */
export class AnnotationCanvasComponent implements GpuComponent<AnnotationCanvasProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private registry: ComponentContext["registry"] | null = null;
  private warnings: ComponentContext["runtime"]["warnings"] | null = null;

  private raster: RasterLayer | null = null;
  private quadLayer: InstancedQuadLayer | null = null;
  private lineLayer: LineLayer | null = null;

  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private fieldUniform: SharedUniforms<FieldUniforms> | null = null;
  private annotationUniform: SharedUniforms<AnnotationUniforms> | null = null;

  private valuesBuffer: StorageBuffer | null = null;
  private valueCapacity = 0;
  private lutBuffer: StorageBuffer | null = null;
  private lutKey: string | null = null;

  private scene: Scene | null = null;
  private uploadedField: FieldData | null = null;
  private uploadedAnnotations: readonly Annotation[] | null = null;
  private currentViewport: ViewportState | null = null;
  private currentColormap: AnnotationColormap = DEFAULT_COLORMAP;
  private currentSelectedId: string | null = null;

  constructor() {
    this.id = `annotationcanvas-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;
    this.registry = ctx.registry;
    this.warnings = ctx.runtime.warnings;

    this.raster = new RasterLayer({ gpu: ctx.gpu, shader: FIELD_WGSL, label: `${this.id}-field` });
    this.quadLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: ANNOTATIONS_WGSL,
      instanceStride: ANNOTATION_INSTANCE_STRIDE,
      capacity: INITIAL_QUAD_CAPACITY,
      label: `${this.id}-shapes`,
      warnings: ctx.runtime.warnings,
    });
    this.lineLayer = new LineLayer({
      gpu: ctx.gpu,
      capacity: INITIAL_LINE_CAPACITY,
      label: `${this.id}-lines`,
      warnings: ctx.runtime.warnings,
    });

    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.fieldUniform = uniforms(ctx.gpu, { width: 1, height: 1, windowMin: 0, windowMax: 1 });
    this.annotationUniform = uniforms(ctx.gpu, {
      strokeWidthPx: STROKE_WIDTH_PX,
      pointSizePx: POINT_SIZE_PX,
      fillOpacity: FILL_OPACITY,
      strokeOpacity: STROKE_OPACITY,
    });

    this.raster.bind({ viewport: this.viewportUniform, params: this.fieldUniform });
    this.quadLayer.bindViewport(this.viewportUniform);
    this.quadLayer.bind({ params: this.annotationUniform });
    this.lineLayer.bindViewport(this.viewportUniform);

    this.acquireLut(this.currentColormap);

    // Placeholder so `values` is always bound, even before the first `update()` — the same
    // mount-order trap `GPUHeatmap` documents (a rAF can land between `create` and `update`).
    this.valueCapacity = 0;
    this.allocValues(this.uploadedField?.values.length ?? 1);

    // Device-loss replay: re-upload from the CPU-side source of truth rather than trusting GPU
    // state that no longer exists (PLAN.md §10.6/§14.2).
    if (this.uploadedField) {
      this.uploadField(this.uploadedField);
      this.scene = createScene(this.uploadedField, this.uploadedAnnotations ?? []);
    }
    if (this.uploadedAnnotations) {
      this.uploadAnnotations(this.uploadedAnnotations, this.currentSelectedId);
    }
    if (this.currentViewport) this.viewportUniform.set(viewportUniforms(this.currentViewport));
  }

  private acquireLut(name: AnnotationColormap): void {
    if (!this.gpu || !this.registry) return;
    const key = name === "gray" ? grayLutKey() : colormapKey(name);
    if (this.lutKey === key && this.lutBuffer) return;
    if (this.lutKey) this.registry.release(this.lutKey);

    this.lutBuffer = this.registry.acquire(key, () => {
      const buffer = storage(this.gpu!, LUT_SIZE * 4 * 4, "read");
      buffer.write(name === "gray" ? buildGrayLut() : buildColormapLut(name));
      return buffer;
    });
    this.lutKey = key;
    this.raster?.bind({ lut: this.lutBuffer });
  }

  private allocValues(count: number): void {
    if (!this.gpu) return;
    if (this.caps) {
      assertBufferBudget(this.caps, count * VALUE_STRIDE, "GPUAnnotationCanvas field values", VALUE_STRIDE);
    }
    this.valueCapacity = Math.max(1, count);
    this.valuesBuffer = storage(this.gpu, this.valueCapacity * VALUE_STRIDE, "read");
    this.raster?.bind({ values: this.valuesBuffer });
  }

  private uploadField(data: FieldData): void {
    if (!this.gpu) return;
    const count = data.values.length;
    if (count > this.valueCapacity) this.allocValues(count);
    this.valuesBuffer?.write(data.values);
  }

  private uploadAnnotations(annotations: readonly Annotation[], selectedId: string | null): void {
    if (annotations.length > RECOMMENDED_MAX_ANNOTATIONS) {
      this.warnings?.report({
        code: "annotationcanvas-size",
        source: this.id,
        message:
          `${annotations.length.toLocaleString("en-US")} annotations exceeds the ~${RECOMMENDED_MAX_ANNOTATIONS.toLocaleString("en-US")} ` +
          `soft cap — CPU hit-testing and per-change buffer rebuilds scale linearly with this count`,
      });
    }
    const { bytes, count } = packQuadInstances(annotations, selectedId);
    this.quadLayer?.upload(bytes, count);
    this.lineLayer?.uploadLines(packLineInstances(annotations, selectedId));
  }

  update(props: AnnotationCanvasProps): void {
    const colormap = props.colormap ?? DEFAULT_COLORMAP;
    if (colormap !== this.currentColormap) {
      this.currentColormap = colormap;
      this.acquireLut(colormap);
    }

    if (props.field !== this.uploadedField) {
      this.uploadField(props.field);
      this.uploadedField = props.field;
      this.scene = createScene(props.field, props.annotations);
      this.uploadedAnnotations = props.annotations;
      this.uploadAnnotations(props.annotations, props.selectedId ?? null);
    } else {
      if (props.annotations !== this.uploadedAnnotations || (props.selectedId ?? null) !== this.currentSelectedId) {
        this.scene?.setAnnotations(props.annotations);
        this.uploadAnnotations(props.annotations, props.selectedId ?? null);
        this.uploadedAnnotations = props.annotations;
      }
    }
    this.currentSelectedId = props.selectedId ?? null;

    this.currentViewport = props.viewport;
    this.viewportUniform?.set(viewportUniforms(props.viewport));

    const window = props.window ?? props.field.window;
    this.fieldUniform?.set({
      width: props.field.width,
      height: props.field.height,
      windowMin: window.min,
      windowMax: window.max,
    });

    this.dirty = true;
  }

  /** CPU hit-test against the retained scene, through the same pixel→image transforms the shaders
   * use — `pixelXToTime`/`pixelYToTrack` with `viewport.yContinuous` set, mirroring `GPUImageDiff`'s
   * arithmetic hit-test rather than a GPU picking pass (PLAN.md §9.5). */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    if (!viewport || !this.scene) return null;
    const imageX = pixelXToTime(viewport, x);
    const imageY = pixelYToTrack(viewport, y);
    const id = this.scene.hitTest(imageX, imageY);
    return id === null ? null : { id };
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedField || !this.currentViewport) return { computePasses: [], renderPasses: [] };
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "annotationcanvas",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.raster?.draw(pass);
            this.quadLayer?.draw(pass);
            this.lineLayer?.draw(pass);
          },
        },
      ],
    };
  }

  dispose(): void {
    this.raster?.dispose();
    this.quadLayer?.dispose();
    this.lineLayer?.dispose();
    if (this.lutKey) this.registry?.release(this.lutKey);
    this.lutKey = null;
    this.lutBuffer = null;
  }
}
