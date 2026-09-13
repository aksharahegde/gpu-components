import {
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
import { uniforms } from "vgpu";
import type { SharedUniforms } from "vgpu";
import { createScene, type Scene } from "./scene.ts";
import type { WhiteboardShape } from "./ingest.ts";
import {
  SHAPE_COLOR_SHIFT,
  SHAPE_FLAG_HOVERED,
  SHAPE_FLAG_SELECTED,
  SHAPE_INSTANCE_STRIDE,
  SHAPE_KIND_ELLIPSE,
  SHAPE_KIND_POINT,
  SHAPE_KIND_RECT,
  SHAPES_WGSL,
} from "./shapes.wgsl.ts";
import { BACKGROUND_WGSL } from "./background.wgsl.ts";

export interface WhiteboardProps {
  readonly shapes: readonly WhiteboardShape[];
  readonly viewport: ViewportState;
  readonly hoveredId?: string | null;
  /** Multi-select, reusing `GPUNodeEditor`'s `selectedNodes` shape — a `Set` rather than a single
   * id, so shift-click and marquee-drag (`GPUWhiteboard.tsx`) can highlight an arbitrary group. */
  readonly selectedIds?: ReadonlySet<string>;
}

interface BackgroundUniforms extends Record<string, unknown> {
  readonly domainMin: readonly [number, number];
  readonly domainMax: readonly [number, number];
}

interface ShapeUniforms extends Record<string, unknown> {
  readonly strokeWidthPx: number;
  readonly pointSizePx: number;
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
}

/** Soft cap — see `ingest.ts`'s `RECOMMENDED_MAX_SHAPES` for why this degrades rather than throws. */
const RECOMMENDED_MAX_SHAPES = 5_000;

const STROKE_WIDTH_PX = 2;
const POINT_SIZE_PX = 8;
const FILL_OPACITY = 0.18;
const STROKE_OPACITY = 0.95;
const INITIAL_QUAD_CAPACITY = 64;
const INITIAL_LINE_CAPACITY = 256;

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

function lineColor(color: number | undefined, brighten: number): number {
  const [r, g, b] = PALETTE_RGB[paletteIndex(color)]!;
  const mix = (c: number) => Math.round(c + (255 - c) * brighten);
  return packRgba8(mix(r), mix(g), mix(b), 255);
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
  const at = index * SHAPE_INSTANCE_STRIDE;
  view.setUint32(at + 0, kind, true);
  view.setUint32(at + 4, flags, true);
  view.setFloat32(at + 8, x, true);
  view.setFloat32(at + 12, y, true);
  view.setFloat32(at + 16, w, true);
  view.setFloat32(at + 20, h, true);
  view.setFloat32(at + 24, 0, true);
  view.setFloat32(at + 28, 0, true);
}

/** Rect/ellipse/point map to one quad each; ruler/polygon/freehand are edges, packed separately
 * for `LineLayer` by `packLineInstances`. Same split `annotationcanvas` uses, for the same reason:
 * one shader can't cheaply express both a filled rounded shape and an arbitrary-length polyline. */
function packQuadInstances(
  shapes: readonly WhiteboardShape[],
  hoveredId: string | null,
  selectedIds: ReadonlySet<string> | undefined,
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly count: number } {
  const quads = shapes.filter(
    (s): s is WhiteboardShape & { kind: "rect" | "ellipse" | "point" } =>
      s.kind === "rect" || s.kind === "ellipse" || s.kind === "point",
  );
  const bytes = new Uint8Array(new ArrayBuffer(Math.max(1, quads.length) * SHAPE_INSTANCE_STRIDE));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < quads.length; i++) {
    const s = quads[i]!;
    const flags =
      (selectedIds?.has(s.id) ? SHAPE_FLAG_SELECTED : 0) |
      (s.id === hoveredId ? SHAPE_FLAG_HOVERED : 0) |
      (paletteIndex(s.color) << SHAPE_COLOR_SHIFT);
    if (s.kind === "point") writeQuadInstance(view, i, SHAPE_KIND_POINT, flags, s.x, s.y, 0, 0);
    else if (s.kind === "rect") writeQuadInstance(view, i, SHAPE_KIND_RECT, flags, s.x, s.y, s.w, s.h);
    else writeQuadInstance(view, i, SHAPE_KIND_ELLIPSE, flags, s.x, s.y, s.w, s.h);
  }
  return { bytes, count: quads.length };
}

function packLineInstances(
  shapes: readonly WhiteboardShape[],
  hoveredId: string | null,
  selectedIds: ReadonlySet<string> | undefined,
): LineInstance[] {
  const lines: LineInstance[] = [];
  for (const s of shapes) {
    const selected = selectedIds?.has(s.id) ?? false;
    const emphasis = selected ? 0.45 : s.id === hoveredId ? 0.25 : 0;
    const widthPx = selected ? STROKE_WIDTH_PX * 1.5 : STROKE_WIDTH_PX;
    const color = lineColor(s.color, emphasis);
    if (s.kind === "ruler") {
      lines.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, widthPx, color });
    } else if (s.kind === "polygon") {
      const pts = s.points;
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i]!;
        const p1 = pts[(i + 1) % pts.length]!;
        lines.push({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, widthPx, color });
      }
    } else if (s.kind === "freehand") {
      const pts = s.points;
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
 * `GPUWhiteboard` — freeform infinite canvas (PLAN.md #14).
 *
 * A procedural background grid (`RasterLayer`, no geometry), shapes forked verbatim from
 * `registry/annotationcanvas` (one quad per rect/ellipse/point via `InstancedQuadLayer`, one line
 * per ruler/polygon/freehand edge via `LineLayer`), and CPU hit-testing against a retained `Scene`.
 * Draw tools, multi-select, move, and delete all live one layer up in `GPUWhiteboard.tsx`
 * (`tools.ts` for creation, the nodeeditor-style shift-click/marquee pattern for selection) — this
 * class stays a pure "given shapes + hover + selection, draw and hit-test them" component, host-owned
 * shapes in, nothing mutated here. No compute passes, no `animating`: nothing here moves on its own.
 */
export class WhiteboardComponent implements GpuComponent<WhiteboardProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private warnings: ComponentContext["runtime"]["warnings"] | null = null;

  private background: RasterLayer | null = null;
  private quadLayer: InstancedQuadLayer | null = null;
  private lineLayer: LineLayer | null = null;

  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private backgroundUniform: SharedUniforms<BackgroundUniforms> | null = null;
  private shapeUniform: SharedUniforms<ShapeUniforms> | null = null;

  private scene: Scene | null = null;
  private uploadedShapes: readonly WhiteboardShape[] | null = null;
  private currentViewport: ViewportState | null = null;
  private currentHoveredId: string | null = null;
  private currentSelectedIds: ReadonlySet<string> | undefined = undefined;

  constructor() {
    this.id = `whiteboard-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.warnings = ctx.runtime.warnings;

    this.background = new RasterLayer({ gpu: ctx.gpu, shader: BACKGROUND_WGSL, label: `${this.id}-bg` });
    this.quadLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: SHAPES_WGSL,
      instanceStride: SHAPE_INSTANCE_STRIDE,
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
    this.backgroundUniform = uniforms(ctx.gpu, { domainMin: [0, 0], domainMax: [1, 1] });
    this.shapeUniform = uniforms(ctx.gpu, {
      strokeWidthPx: STROKE_WIDTH_PX,
      pointSizePx: POINT_SIZE_PX,
      fillOpacity: FILL_OPACITY,
      strokeOpacity: STROKE_OPACITY,
    });

    this.background.bind({ viewport: this.viewportUniform, params: this.backgroundUniform });
    this.quadLayer.bindViewport(this.viewportUniform);
    this.quadLayer.bind({ params: this.shapeUniform });
    this.lineLayer.bindViewport(this.viewportUniform);

    // Device-loss replay: re-derive from the CPU-side source of truth (PLAN.md §10.6/§14.2).
    if (this.uploadedShapes) {
      this.scene = createScene(this.uploadedShapes);
      this.uploadShapes(this.uploadedShapes, this.currentHoveredId, this.currentSelectedIds);
    }
    if (this.currentViewport) this.writeViewport(this.currentViewport);
  }

  private uploadShapes(
    shapes: readonly WhiteboardShape[],
    hoveredId: string | null,
    selectedIds: ReadonlySet<string> | undefined,
  ): void {
    if (shapes.length > RECOMMENDED_MAX_SHAPES) {
      this.warnings?.report({
        code: "whiteboard-size",
        source: this.id,
        message:
          `${shapes.length.toLocaleString("en-US")} shapes exceeds the ~${RECOMMENDED_MAX_SHAPES.toLocaleString("en-US")} ` +
          `soft cap — CPU hit-testing and per-change buffer rebuilds scale linearly with this count`,
      });
    }
    const { bytes, count } = packQuadInstances(shapes, hoveredId, selectedIds);
    this.quadLayer?.upload(bytes, count);
    this.lineLayer?.uploadLines(packLineInstances(shapes, hoveredId, selectedIds));
  }

  private writeViewport(viewport: ViewportState): void {
    this.viewportUniform?.set(viewportUniforms(viewport));
    const rowStart = viewport.rowStart ?? 0;
    const rowEnd = viewport.rowEnd ?? viewport.trackCount;
    this.backgroundUniform?.set({
      domainMin: [viewport.timeStart, rowStart],
      domainMax: [viewport.timeEnd, rowEnd],
    });
  }

  update(props: WhiteboardProps): void {
    const hoveredId = props.hoveredId ?? null;
    const selectedIds = props.selectedIds;
    if (
      props.shapes !== this.uploadedShapes ||
      hoveredId !== this.currentHoveredId ||
      selectedIds !== this.currentSelectedIds
    ) {
      if (props.shapes !== this.uploadedShapes) this.scene = createScene(props.shapes);
      else this.scene?.setShapes(props.shapes);
      this.uploadShapes(props.shapes, hoveredId, selectedIds);
      this.uploadedShapes = props.shapes;
      this.currentHoveredId = hoveredId;
      this.currentSelectedIds = selectedIds;
    }

    this.currentViewport = props.viewport;
    this.writeViewport(props.viewport);
    this.dirty = true;
  }

  /** CPU hit-test against the retained scene — same reasoning as every other component here that
   * declines GPU picking (PLAN.md §9.5): shapes move only on an explicit drag, never every frame on
   * their own, so there is no "rebuild every frame" cost to justify it. */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    if (!viewport || !this.scene) return null;
    const domainX = pixelXToTime(viewport, x);
    const domainY = pixelYToTrack(viewport, y);
    const id = this.scene.hitTest(domainX, domainY);
    return id === null ? null : { id };
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.currentViewport) return { computePasses: [], renderPasses: [] };
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "whiteboard",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.background?.draw(pass);
            this.lineLayer?.draw(pass);
            this.quadLayer?.draw(pass);
          },
        },
      ],
    };
  }

  dispose(): void {
    this.background?.dispose();
    this.quadLayer?.dispose();
    this.lineLayer?.dispose();
  }
}
