import { assertBufferBudget, dispatchWorkgroups, viewportUniforms } from "@gpu-components/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpu-components/core";
import { compute, draw, pingPongStorage, storage, uniforms } from "vgpu";
import type { Compute, Draw, Gpu, PingPongStorage, SharedUniforms, StorageBuffer } from "vgpu";
import { EDGE_STRIDE, POSITION_STRIDE, type GraphData } from "./ingest.ts";
import { LAYOUT_WGSL, LAYOUT_WORKGROUP_SIZE } from "./layout.wgsl.ts";
import { EDGE_WGSL, NODE_WGSL } from "./graph.wgsl.ts";

export interface GraphProps {
  readonly data: GraphData;
  readonly viewport: ViewportState;
  readonly hoveredNode?: number | null;
  readonly selectedNode?: number | null;
  /** Stops the simulation without unmounting — useful once a layout looks right. */
  readonly paused?: boolean;
  readonly nodeSizePx?: number;
  readonly edgeWidthPx?: number;
}

interface LayoutUniforms extends Record<string, unknown> {
  readonly nodeCount: number;
  readonly repulsion: number;
  readonly attraction: number;
  readonly damping: number;
  readonly dt: number;
  readonly centering: number;
  readonly maxStep: number;
}

interface GraphUniforms extends Record<string, unknown> {
  readonly nodeSizePx: number;
  readonly edgeWidthPx: number;
  readonly hoveredNode: number;
  readonly selectedNode: number;
}

/** Layout constants, tuned for a unit-ish coordinate space. Policy, so they live in copied source. */
const DEFAULTS = {
  repulsion: 0.0008,
  attraction: 0.35,
  damping: 0.82,
  dt: 0.35,
  centering: 0.06,
  maxStep: 0.05,
} as const;

/**
 * Iterations after which the simulation stops on its own.
 *
 * A force layout has no natural end, and §17.3 forbids "unbounded memory growth" and silent
 * open-ended work by the same logic: a component that animates forever is a component that burns a
 * GPU on a background tab. Convergence is declared by iteration count rather than by measuring
 * total displacement, because measuring it would mean reading the position buffer back every frame
 * — precisely the per-frame readback §5 gate 4 disqualifies.
 */
const MAX_ITERATIONS = 600;

/** Above this the O(n²) repulsion loop stops being the right approach — see `layout.wgsl.ts`. */
const RECOMMENDED_MAX_NODES = 5000;

let nextId = 0;

/**
 * `GPUGraph` — force-directed layout, and the component that finally exercises three paths in
 * `core` that nothing had touched.
 *
 * **It animates.** No other component sets `animating = true`; every one of them is dirty-driven,
 * redrawing only when props change. This one keeps the scheduler running until the layout settles,
 * which is the first production use of that branch.
 *
 * **It iterates.** Positions feed back into themselves through `pingPongStorage` — PLAN.md §19.2's
 * ninth optimisation step, unused until now. Every previous compute pass read static data and wrote
 * somewhere else.
 *
 * **Its positions live only on the GPU.** Nothing reads them back per frame (§5, gate 4), which is
 * why hover here cannot use the spatial-index trick `GPUScatter` uses: that index is built once
 * from CPU-side coordinates, and these coordinates move every frame and are never on the CPU. This
 * is the case PLAN.md §9.5 reserves asynchronous GPU picking for, and — unlike the scatter, where
 * the claim did not hold — here it does.
 *
 * Hover is therefore **not implemented in v1**, rather than implemented badly: `hitTest` returns
 * null and says why. Wiring it up means building `core`'s `Picker`, which this component is the
 * first honest justification for.
 */
export class GraphComponent implements GpuComponent<GraphProps> {
  readonly id: string;
  dirty = true;
  /** True while the layout is still settling — the scheduler keeps ticking us. */
  animating = true;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private warnings: ComponentContext["runtime"]["warnings"] | null = null;

  private layout: Compute | null = null;
  private layoutParams: SharedUniforms<LayoutUniforms> | null = null;
  private graphParams: SharedUniforms<GraphUniforms> | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;

  /** The ping-pong pair the layout reads from and writes to, swapped each iteration. */
  private positions: PingPongStorage | null = null;
  private velocity: StorageBuffer | null = null;
  private edgeBuffer: StorageBuffer | null = null;
  private categoryBuffer: StorageBuffer | null = null;
  private adjacencyStarts: StorageBuffer | null = null;
  private adjacencyItems: StorageBuffer | null = null;

  private nodeDraw: Draw | null = null;
  private edgeDraw: Draw | null = null;

  private uploadedData: GraphData | null = null;
  private currentViewport: ViewportState | null = null;
  private iterations = 0;
  private paused = false;

  constructor() {
    this.id = `graph-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;
    this.warnings = ctx.runtime.warnings;

    this.layout = compute(ctx.gpu, LAYOUT_WGSL);
    this.layoutParams = uniforms(ctx.gpu, { nodeCount: 0, ...DEFAULTS });
    this.graphParams = uniforms(ctx.gpu, {
      nodeSizePx: 8,
      edgeWidthPx: 1,
      hoveredNode: -1,
      selectedNode: -1,
    });
    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });

    this.nodeDraw = draw(ctx.gpu, { shader: NODE_WGSL, vertices: 6, blend: "alpha", label: `${this.id}-nodes` });
    this.edgeDraw = draw(ctx.gpu, { shader: EDGE_WGSL, vertices: 6, blend: "alpha", label: `${this.id}-edges` });

    // Allocate against whatever data is already held, so a device-loss replay rebuilds identically
    // (§10.6) — and a placeholder otherwise, so bindings are valid before the first update.
    this.allocate(this.uploadedData);
    if (this.uploadedData) this.upload(this.uploadedData);
    if (this.currentViewport) this.viewportUniform.set(viewportUniforms(this.currentViewport));
  }

  private allocate(data: GraphData | null): void {
    if (!this.gpu) return;
    const nodes = Math.max(1, data?.nodeCount ?? 1);
    const edges = Math.max(1, data?.edgeCount ?? 1);

    if (this.caps) {
      assertBufferBudget(this.caps, nodes * POSITION_STRIDE, "GPUGraph positions", POSITION_STRIDE);
      assertBufferBudget(this.caps, edges * EDGE_STRIDE, "GPUGraph edges", EDGE_STRIDE);
    }

    // The pair that makes iteration possible without allocating inside the loop (§19.2 step 9).
    this.positions = pingPongStorage(this.gpu, nodes * POSITION_STRIDE);
    this.velocity = storage(this.gpu, nodes * POSITION_STRIDE, "read-write");
    this.edgeBuffer = storage(this.gpu, edges * EDGE_STRIDE, "read");
    // Categories are bytes but bound as u32 words; the shader unpacks. Rounded up to a whole word.
    this.categoryBuffer = storage(this.gpu, Math.ceil(nodes / 4) * 4, "read");
    this.adjacencyStarts = storage(this.gpu, (nodes + 1) * 4, "read");
    this.adjacencyItems = storage(this.gpu, Math.max(1, (data?.edgeCount ?? 0) * 2) * 4, "read");

    this.velocity.write(new Float32Array(nodes * 2));
    this.bindAll();
  }

  /** Re-binds everything that depends on buffer identity. Called after allocation and after every
   * ping-pong swap, since the swap changes which buffer is `read` and which is `write`. */
  private bindAll(): void {
    if (!this.positions) return;
    this.layout?.set({
      params: this.layoutParams,
      posIn: this.positions.read,
      posOut: this.positions.write,
      velocity: this.velocity,
      adjacencyStarts: this.adjacencyStarts,
      adjacencyItems: this.adjacencyItems,
    });
    // The render pass reads whichever half the last iteration wrote.
    this.nodeDraw?.set({
      viewport: this.viewportUniform,
      params: this.graphParams,
      positions: this.positions.read,
      category: this.categoryBuffer,
    });
    this.edgeDraw?.set({
      viewport: this.viewportUniform,
      params: this.graphParams,
      positions: this.positions.read,
      edges: this.edgeBuffer,
    });
  }

  private upload(data: GraphData): void {
    this.positions?.read.write(data.positions);
    this.positions?.write.write(data.positions);
    this.velocity?.write(new Float32Array(data.nodeCount * 2));
    if (data.edgeCount > 0) this.edgeBuffer?.write(data.edges);
    this.adjacencyStarts?.write(data.adjacencyStarts);
    if (data.adjacencyItems.length > 0) this.adjacencyItems?.write(data.adjacencyItems);

    // Pack the byte categories into u32 words the shader can index.
    const words = new Uint32Array(Math.ceil(data.nodeCount / 4));
    for (let i = 0; i < data.nodeCount; i++) {
      words[i >>> 2]! |= (data.category[i]! & 255) << ((i % 4) * 8);
    }
    this.categoryBuffer?.write(words);

    this.layoutParams?.set({ nodeCount: data.nodeCount, ...DEFAULTS });

    if (data.nodeCount > RECOMMENDED_MAX_NODES) {
      this.warnings?.report({
        code: "graph-size",
        source: this.id,
        message:
          `${data.nodeCount.toLocaleString("en-US")} nodes exceeds the ~${RECOMMENDED_MAX_NODES.toLocaleString("en-US")} ` +
          `this layout's O(n^2) repulsion is meant for — expect the simulation to dominate the frame`,
      });
    }
  }

  update(props: GraphProps): void {
    if (props.data !== this.uploadedData) {
      const grew = props.data.nodeCount > (this.uploadedData?.nodeCount ?? 0) ||
        props.data.edgeCount > (this.uploadedData?.edgeCount ?? 0);
      this.uploadedData = props.data;
      if (grew || !this.positions) this.allocate(props.data);
      this.upload(props.data);
      // New data means a new layout: run the simulation again.
      this.iterations = 0;
    }

    this.currentViewport = props.viewport;
    this.viewportUniform?.set(viewportUniforms(props.viewport));
    this.graphParams?.set({
      nodeSizePx: props.nodeSizePx ?? 8,
      edgeWidthPx: props.edgeWidthPx ?? 1,
      hoveredNode: props.hoveredNode ?? -1,
      selectedNode: props.selectedNode ?? -1,
    });

    this.paused = props.paused ?? false;
    this.animating = !this.paused && this.iterations < MAX_ITERATIONS;
    this.dirty = true;
  }

  /** True once the layout has stopped moving — surfaced so a wrapper can show a "settled" state. */
  get settled(): boolean {
    return this.iterations >= MAX_ITERATIONS;
  }

  get iterationCount(): number {
    return this.iterations;
  }

  /**
   * Not implemented, and that is the finding rather than an omission.
   *
   * `GPUScatter` hovers exactly and instantly through a uniform grid built once from CPU-side
   * coordinates. A graph's coordinates move every iteration and exist only on the GPU, so the same
   * index would have to be rebuilt every frame from data that would first have to be read back —
   * the per-frame readback §5 gate 4 rules out. This is the case §9.5 reserves asynchronous
   * ID-buffer picking for, and building `core`'s `Picker` is the honest next step.
   */
  hitTest(): HitResult | null {
    return null;
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedData || !this.currentViewport) return { computePasses: [], renderPasses: [] };
    const data = this.uploadedData;

    const computePasses = this.animating
      ? [{ name: "graph-layout", dispatch: () => this.iterate(data.nodeCount) }]
      : [];

    return {
      computePasses,
      renderPasses: [
        {
          name: "graph",
          target: "surface",
          clear: true,
          encode: (pass) => {
            if (pass.kind !== "gpu") return; // no Canvas2D fallback for a GPU-resident layout
            if (data.edgeCount > 0) pass.frame.draw(this.edgeDraw!, { instances: data.edgeCount });
            pass.frame.draw(this.nodeDraw!, { instances: data.nodeCount });
          },
        },
      ],
    };
  }

  /** One layout iteration, then swap so the next one reads what this one wrote. */
  private iterate(nodeCount: number): void {
    if (!this.layout || !this.positions || !this.caps) return;
    this.layout.dispatch(
      dispatchWorkgroups(this.caps, nodeCount, LAYOUT_WORKGROUP_SIZE, {
        warnings: this.warnings ?? undefined,
        source: "graph-layout",
      }),
    );
    this.positions.swap();
    this.bindAll();

    this.iterations++;
    if (this.iterations >= MAX_ITERATIONS) this.animating = false;
    // Still moving: ask for another frame. The scheduler only re-runs a component that says so.
    this.dirty = true;
  }

  dispose(): void {
    // Storage buffers and the ping-pong pair are reclaimed with the owning `Gpu` — see
    // `InstancedQuadLayer.dispose()`'s note on vgpu's lack of a public destroy.
  }
}
