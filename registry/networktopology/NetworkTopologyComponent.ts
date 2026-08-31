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
import { EDGE_STRIDE, POSITION_STRIDE, type TopologyData } from "./ingest.ts";
import { LAYOUT_WGSL, LAYOUT_WORKGROUP_SIZE } from "./layout.wgsl.ts";
import { EDGE_WGSL, NODE_WGSL } from "./topology.wgsl.ts";

export interface TopologyProps {
  readonly data: TopologyData;
  readonly viewport: ViewportState;
  /** Stops the simulation without unmounting — useful once a layout looks right. */
  readonly paused?: boolean;
  readonly selectedNode?: number | null;
  readonly nodeSizePx?: number;
  readonly edgeWidthPx?: number;
  /** Multiplier on how fast the traffic pulse travels along an edge. */
  readonly pulseSpeed?: number;
  /** Clock driving the edge pulse; the wrapper advances this via rAF (Task 5) so the glow keeps
   * moving after the layout settles. */
  readonly time?: number;
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

interface TopologyUniforms extends Record<string, unknown> {
  readonly nodeSizePx: number;
  readonly edgeWidthPx: number;
  readonly selectedNode: number;
  readonly time: number;
  readonly pulseSpeed: number;
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
 * Iterations after which the simulation stops on its own — see `GraphComponent`'s note on §17.3.
 * Layout compute stops here, but `animating` does not: the traffic pulse is driven by `time`, a
 * clock the wrapper keeps advancing, so the scheduler must keep ticking this component for that
 * glow to move even once the positions themselves are still.
 */
const MAX_ITERATIONS = 600;

/** Above this the O(n²) repulsion loop stops being the right approach — see `layout.wgsl.ts`. */
const RECOMMENDED_MAX_NODES = 5_000;

/** Iterations between `onProgress` notifications. */
const PROGRESS_INTERVAL = 15;

let nextId = 0;

/**
 * `GPUNetworkTopology` — force-directed layout over a kind/status-tagged mesh, with a traffic
 * pulse that keeps moving along healthy, busy edges after the layout itself has settled.
 *
 * Structurally this is `GraphComponent` (positions, ping-pong layout, CSR adjacency) plus two
 * independent axes that layout doesn't touch: per-node `kind`/`status` (packed the same way
 * `GraphComponent` packs `category`) and per-edge `health`/`traffic` (plain `f32` storage, read
 * by the edge fragment shader to mix colour and drive the pulse).
 *
 * **Animating outlives converging.** `GraphComponent` ties `animating` to "still has layout work
 * to do." Here that would be wrong: the pulse in `EDGE_WGSL`'s fragment shader is a function of
 * `params.time`, and `time` is a prop the wrapper advances every frame regardless of whether the
 * positions are still moving. If `animating` dropped to `false` at `MAX_ITERATIONS`, the scheduler
 * would stop calling `plan()`, the `time` uniform would stop being pushed, and a busy edge's glow
 * would freeze mid-cycle the moment the graph stopped moving — silently wrong rather than loudly
 * wrong, the worse of the two per §24. So `animating` tracks `!paused` alone; `MAX_ITERATIONS`
 * only gates the compute pass, not the flag.
 */
export class NetworkTopologyComponent implements GpuComponent<TopologyProps> {
  readonly id: string;
  dirty = true;
  /** True whenever not paused — kept true past layout settlement so pulse/time keep updating. */
  animating = true;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;
  private warnings: ComponentContext["runtime"]["warnings"] | null = null;

  private layout: Compute | null = null;
  private layoutParams: SharedUniforms<LayoutUniforms> | null = null;
  private topologyParams: SharedUniforms<TopologyUniforms> | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;

  /** The ping-pong pair the layout reads from and writes to, swapped each iteration. */
  private positions: PingPongStorage | null = null;
  private velocity: StorageBuffer | null = null;
  private edgeBuffer: StorageBuffer | null = null;
  private kindBuffer: StorageBuffer | null = null;
  private statusBuffer: StorageBuffer | null = null;
  private edgeHealthBuffer: StorageBuffer | null = null;
  private edgeTrafficBuffer: StorageBuffer | null = null;
  private adjacencyStarts: StorageBuffer | null = null;
  private adjacencyItems: StorageBuffer | null = null;

  private nodeDraw: Draw | null = null;
  private edgeDraw: Draw | null = null;

  private uploadedData: TopologyData | null = null;
  private currentViewport: ViewportState | null = null;
  private iterations = 0;
  private paused = false;

  /**
   * Progress notification, assigned by the wrapper at construction — see `GraphComponent`'s note
   * on why this is pushed rather than polled and throttled to `PROGRESS_INTERVAL`.
   */
  onProgress: ((iterations: number, settled: boolean) => void) | null = null;

  constructor() {
    this.id = `networktopology-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;
    this.warnings = ctx.runtime.warnings;

    this.layout = compute(ctx.gpu, LAYOUT_WGSL);
    this.layoutParams = uniforms(ctx.gpu, { nodeCount: 0, ...DEFAULTS });
    this.topologyParams = uniforms(ctx.gpu, {
      nodeSizePx: 8,
      edgeWidthPx: 1,
      selectedNode: -1,
      time: 0,
      pulseSpeed: 1,
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

  private allocate(data: TopologyData | null): void {
    if (!this.gpu) return;
    const nodes = Math.max(1, data?.nodeCount ?? 1);
    const edges = Math.max(1, data?.edgeCount ?? 1);

    if (this.caps) {
      assertBufferBudget(this.caps, nodes * POSITION_STRIDE, "GPUNetworkTopology positions", POSITION_STRIDE);
      assertBufferBudget(this.caps, edges * EDGE_STRIDE, "GPUNetworkTopology edges", EDGE_STRIDE);
    }

    // The pair that makes iteration possible without allocating inside the loop (§19.2 step 9).
    this.positions = pingPongStorage(this.gpu, nodes * POSITION_STRIDE);
    this.velocity = storage(this.gpu, nodes * POSITION_STRIDE, "read-write");
    this.edgeBuffer = storage(this.gpu, edges * EDGE_STRIDE, "read");
    // Kind/status are bytes but bound as u32 words; the shader unpacks. Rounded up to a whole word.
    this.kindBuffer = storage(this.gpu, Math.ceil(nodes / 4) * 4, "read");
    this.statusBuffer = storage(this.gpu, Math.ceil(nodes / 4) * 4, "read");
    this.edgeHealthBuffer = storage(this.gpu, edges * 4, "read");
    this.edgeTrafficBuffer = storage(this.gpu, edges * 4, "read");
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
      params: this.topologyParams,
      positions: this.positions.read,
      kind: this.kindBuffer,
      status: this.statusBuffer,
    });
    this.edgeDraw?.set({
      viewport: this.viewportUniform,
      params: this.topologyParams,
      positions: this.positions.read,
      edges: this.edgeBuffer,
      edgeHealth: this.edgeHealthBuffer,
      edgeTraffic: this.edgeTrafficBuffer,
    });
  }

  private upload(data: TopologyData): void {
    this.positions?.read.write(data.positions);
    this.positions?.write.write(data.positions);
    this.velocity?.write(new Float32Array(data.nodeCount * 2));
    if (data.edgeCount > 0) {
      this.edgeBuffer?.write(data.edges);
      this.edgeHealthBuffer?.write(data.edgeHealth);
      this.edgeTrafficBuffer?.write(data.edgeTraffic);
    }
    this.adjacencyStarts?.write(data.adjacencyStarts);
    if (data.adjacencyItems.length > 0) this.adjacencyItems?.write(data.adjacencyItems);

    // Pack the byte kind/status arrays into u32 words the shader can index — same trick
    // `GraphComponent` uses for `category`.
    const kindWords = new Uint32Array(Math.ceil(data.nodeCount / 4));
    const statusWords = new Uint32Array(Math.ceil(data.nodeCount / 4));
    for (let i = 0; i < data.nodeCount; i++) {
      kindWords[i >>> 2]! |= (data.kind[i]! & 255) << ((i % 4) * 8);
      statusWords[i >>> 2]! |= (data.status[i]! & 255) << ((i % 4) * 8);
    }
    this.kindBuffer?.write(kindWords);
    this.statusBuffer?.write(statusWords);

    this.layoutParams?.set({ nodeCount: data.nodeCount, ...DEFAULTS });

    if (data.nodeCount > RECOMMENDED_MAX_NODES) {
      this.warnings?.report({
        code: "networktopology-size",
        source: this.id,
        message:
          `${data.nodeCount.toLocaleString("en-US")} nodes exceeds the ~${RECOMMENDED_MAX_NODES.toLocaleString("en-US")} ` +
          `this layout's O(n^2) repulsion is meant for — expect the simulation to dominate the frame`,
      });
    }
  }

  update(props: TopologyProps): void {
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
    this.topologyParams?.set({
      nodeSizePx: props.nodeSizePx ?? 8,
      edgeWidthPx: props.edgeWidthPx ?? 1,
      selectedNode: props.selectedNode ?? -1,
      time: props.time ?? 0,
      pulseSpeed: props.pulseSpeed ?? 1,
    });

    this.paused = props.paused ?? false;
    // Unlike `GraphComponent`, animating tracks pause alone: the pulse needs frames from `time`
    // long after `iterations` hits `MAX_ITERATIONS` (see class doc).
    this.animating = !this.paused;
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
   * Not implemented, for the same reason `GraphComponent.hitTest` isn't: positions move every
   * layout iteration and live only on the GPU, so there is no CPU-side coordinate to hit-test
   * against without a per-frame readback (§5 gate 4).
   */
  hitTest(): HitResult | null {
    return null;
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedData || !this.currentViewport) return { computePasses: [], renderPasses: [] };
    const data = this.uploadedData;

    const computePasses =
      !this.paused && this.iterations < MAX_ITERATIONS
        ? [{ name: "networktopology-layout", dispatch: () => this.iterate(data.nodeCount) }]
        : [];

    return {
      computePasses,
      renderPasses: [
        {
          name: "networktopology",
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
        source: "networktopology-layout",
      }),
    );
    this.positions.swap();
    this.bindAll();

    this.iterations++;
    const settledNow = this.iterations >= MAX_ITERATIONS;
    if (this.iterations % PROGRESS_INTERVAL === 0 || settledNow) {
      this.onProgress?.(this.iterations, this.settled);
    }
    // Layout work may be done, but the pulse still needs frames — dirty stays true regardless.
    this.dirty = true;
  }

  dispose(): void {
    // Storage buffers and the ping-pong pair are reclaimed with the owning `Gpu` — see
    // `InstancedQuadLayer.dispose()`'s note on vgpu's lack of a public destroy.
  }
}
