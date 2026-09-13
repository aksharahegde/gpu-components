import {
  assertBufferBudget,
  InstancedQuadLayer,
  LineLayer,
  packRgba8,
  pixelXToTime,
  pixelYToTrack,
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
import { NODE_STRIDE, packNodes, type DepGraphData } from "./ingest.ts";
import { MAX_LINE_SEGMENTS } from "./layout.ts";
import { NODES_WGSL } from "./nodes.wgsl.ts";

export interface DepGraphProps {
  readonly data: DepGraphData;
  readonly viewport: ViewportState;
  readonly hoveredNode?: number | null;
  readonly selectedNode?: number | null;
  readonly nodeSizePx?: number;
  readonly edgeWidthPx?: number;
  readonly opacity?: number;
}

interface NodeUniforms extends Record<string, unknown> {
  readonly nodeSizePx: number;
  readonly hoveredNode: number;
  readonly selectedNode: number;
  readonly opacity: number;
}

const DEFAULT_NODE_PX = 14;
const DEFAULT_EDGE_PX = 1.5;
const HOVER_RADIUS_PX = 16;

const FORWARD_COLOR = packRgba8(110, 124, 150, 170);
const BACK_COLOR = packRgba8(192, 64, 48, 210);

let nextId = 0;

/**
 * `GPUDepGraph` — layered dependency graph (PLAN.md #16).
 *
 * Layout is pure CPU Sugiyama + orthogonal routes at ingest; the GPU only draws nodes and
 * line segments. No compute passes, no continuous animation.
 */
export class DepGraphComponent implements GpuComponent<DepGraphProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private caps: ComponentContext["caps"] | null = null;
  private nodeLayer: InstancedQuadLayer | null = null;
  private edgeLayer: LineLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private nodeParams: SharedUniforms<NodeUniforms> | null = null;

  private uploadedData: DepGraphData | null = null;
  private currentViewport: ViewportState | null = null;

  constructor() {
    this.id = `depgraph-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.caps = ctx.caps;

    this.nodeLayer = new InstancedQuadLayer({
      gpu: ctx.gpu,
      shader: NODES_WGSL,
      instanceStride: NODE_STRIDE,
      capacity: Math.max(1, this.uploadedData?.nodeCount ?? 64),
      label: `${this.id}-nodes`,
      warnings: ctx.runtime.warnings,
    });
    this.edgeLayer = new LineLayer({
      gpu: ctx.gpu,
      capacity: Math.min(MAX_LINE_SEGMENTS, Math.max(64, this.uploadedData?.segments.length ?? 64)),
      label: `${this.id}-edges`,
      warnings: ctx.runtime.warnings,
    });

    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.nodeParams = uniforms(ctx.gpu, {
      nodeSizePx: DEFAULT_NODE_PX,
      hoveredNode: -1,
      selectedNode: -1,
      opacity: 1,
    });

    this.nodeLayer.bindViewport(this.viewportUniform);
    this.edgeLayer.bindViewport(this.viewportUniform);
    this.nodeLayer.bind({ params: this.nodeParams });

    if (this.uploadedData) this.uploadData(this.uploadedData);
    if (this.currentViewport) this.writeViewport(this.currentViewport);
  }

  private uploadData(data: DepGraphData): void {
    if (this.caps) {
      assertBufferBudget(this.caps, data.nodeCount * NODE_STRIDE, "GPUDepGraph nodes", NODE_STRIDE);
    }
    this.nodeLayer?.upload(packNodes(data), data.nodeCount);

    const lines: LineInstance[] = [];
    const limit = Math.min(data.segments.length, MAX_LINE_SEGMENTS);
    for (let i = 0; i < limit; i++) {
      const s = data.segments[i]!;
      lines.push({
        x0: s.x0,
        y0: s.y0,
        x1: s.x1,
        y1: s.y1,
        widthPx: s.backEdge ? DEFAULT_EDGE_PX * 1.25 : DEFAULT_EDGE_PX,
        color: s.backEdge ? BACK_COLOR : FORWARD_COLOR,
      });
    }
    this.edgeLayer?.uploadLines(lines);
  }

  private writeViewport(viewport: ViewportState): void {
    this.viewportUniform?.set(viewportUniforms(viewport));
  }

  update(props: DepGraphProps): void {
    if (props.data !== this.uploadedData) {
      this.uploadedData = props.data;
      this.uploadData(props.data);
    }
    this.currentViewport = props.viewport;
    this.writeViewport(props.viewport);
    this.nodeParams?.set({
      nodeSizePx: props.nodeSizePx ?? DEFAULT_NODE_PX,
      hoveredNode: props.hoveredNode ?? -1,
      selectedNode: props.selectedNode ?? -1,
      opacity: props.opacity ?? 1,
    });
    this.dirty = true;
  }

  hitTest(px: number, py: number): HitResult | null {
    const viewport = this.currentViewport;
    const data = this.uploadedData;
    if (!viewport || !data) return null;

    const dataX = pixelXToTime(viewport, px);
    const dataY = pixelYToTrack(viewport, py);
    const unitsPerPxX = (viewport.timeEnd - viewport.timeStart) / Math.max(viewport.width, 1);
    const rowStart = viewport.rowStart ?? 0;
    const rowEnd = viewport.rowEnd ?? viewport.trackCount;
    const unitsPerPxY = (rowEnd - rowStart) / Math.max(viewport.height, 1);
    const radius = HOVER_RADIUS_PX * Math.max(unitsPerPxX, unitsPerPxY);
    const r2 = radius * radius;

    let best = -1;
    let bestD = r2;
    for (let i = 0; i < data.nodeCount; i++) {
      const dx = data.x[i]! - dataX;
      const dy = data.y[i]! - dataY;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best < 0 ? null : { id: best };
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedData || !this.currentViewport) {
      return { computePasses: [], renderPasses: [] };
    }
    return {
      computePasses: [],
      renderPasses: [
        {
          name: "depgraph",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.edgeLayer?.draw(pass);
            this.nodeLayer?.draw(pass);
          },
        },
      ],
    };
  }

  dispose(): void {
    this.nodeLayer?.dispose();
    this.edgeLayer?.dispose();
  }
}
