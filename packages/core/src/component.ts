import type { FramePass, Gpu, SharedUniforms, Target } from "vgpu";
import type { Capabilities } from "./capabilities.ts";
import type { ResourceRegistry } from "./registry.ts";
import type { Globals } from "./uniforms.ts";
import type { SurfaceLike } from "./surface.ts";

/** Something a `RenderPlan` reads or writes. Declared, unused in v1 (see PLAN.md §11.3) — reserved
 * for a future topological sort if pass count ever grows past ~20. */
export interface ResourceRef {
  readonly key: string;
}

export interface ComputePass {
  readonly name: string;
  readonly reads?: readonly ResourceRef[];
  readonly writes?: readonly ResourceRef[];
  /** Encodes and dispatches this pass's compute work. Called after every component's compute
   * passes have been collected and before any render pass runs. */
  dispatch(): void;
}

export interface RenderPass {
  readonly name: string;
  readonly reads?: readonly ResourceRef[];
  readonly writes?: readonly ResourceRef[];
  /** `'surface'` targets this component's own canvas surface. */
  readonly target: "surface" | Target;
  readonly clear?: boolean;
  readonly scissor?: readonly [number, number, number, number];
  /** Encodes this pass's draws against the `vgpu` frame pass the scheduler opened for it. */
  encode(pass: FramePass): void;
}

export interface RenderPlan {
  readonly computePasses: readonly ComputePass[];
  readonly renderPasses: readonly RenderPass[];
}

export const EMPTY_PLAN: RenderPlan = { computePasses: [], renderPasses: [] };

export interface FrameContext {
  readonly time: number;
  readonly deltaTime: number;
  readonly frameCount: number;
}

/** The subset of `GpuRuntime` a component is allowed to see. Kept structural (not imported from
 * `runtime.ts`) so `component.ts` never depends on the concrete runtime class. */
export interface RuntimeHandle {
  readonly caps: Capabilities;
  invalidate(reason?: string): void;
}

export interface ComponentContext {
  readonly runtime: RuntimeHandle;
  /** vgpu context — documented escape hatch (PLAN.md §9.4). */
  readonly gpu: Gpu;
  readonly surface: SurfaceLike;
  readonly globals: SharedUniforms<Globals>;
  readonly registry: ResourceRegistry;
  readonly caps: Capabilities;
  /** Teardown accumulator: register a cleanup function, run once by `dispose()`. */
  readonly onDispose: (fn: () => void) => void;
}

export interface HitResult {
  readonly id: string | number;
}

export interface SemanticModel {
  readonly role: string;
  readonly label: string;
  readonly children?: readonly SemanticModel[];
}

/**
 * The four-method component contract (PLAN.md §9.4). `create` allocates once; `update` reacts to
 * props without creating pipelines; `plan` is pure — it describes passes, it does not encode them;
 * `dispose` must be idempotent (StrictMode / Fast Refresh call it twice).
 *
 * Every GPU buffer a component owns must be regenerable from a CPU-side source of truth: on device
 * loss the runtime disposes and replays every mounted component's `create()`, then calls
 * `onContextRestored()` so the component re-uploads from that source, not from GPU state that no
 * longer exists.
 */
export interface GpuComponent<Props = unknown> {
  readonly id: string;
  /** True while this component has unconsumed changes or is animating; the scheduler skips a
   * clean, non-animating component entirely. */
  readonly dirty: boolean;
  readonly animating?: boolean;

  create(ctx: ComponentContext): void;
  update(props: Props): void;
  plan(frame: FrameContext): RenderPlan;
  dispose(): void;

  hitTest?(x: number, y: number): HitResult | null;
  describe?(): SemanticModel;
  onContextRestored?(): void;
}
