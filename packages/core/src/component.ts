import type { Gpu, SharedUniforms, Target } from "vgpu";
import type { PassEncoder } from "./passEncoder.ts";
import type { Capabilities } from "./capabilities.ts";
import type { ResourceRegistry } from "./registry.ts";
import type { Globals } from "./uniforms.ts";
import type { SurfaceLike } from "./surface.ts";
import type { WarningsLog } from "./warnings.ts";
import type { ViewportUniforms } from "./viewport.ts";

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
  /** Encodes this pass's draws against whatever backend the scheduler opened — the `vgpu` frame
   * pass, or the Canvas2D fallback (PLAN.md §22.2). Components draw through the core primitives
   * (`layer.draw(pass)`) and stay backend-agnostic; only a component reaching for
   * `pass.kind === 'gpu'`'s raw `frame` gives up its fallback. */
  encode(pass: PassEncoder): void;
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
  /** PLAN.md §28.2's warnings pane — a component (or a `core` layer it constructs, e.g.
   * `InstancedQuadLayer`) reports anti-patterns into this, and `GpuInspector` reads them back. */
  readonly warnings: WarningsLog;
}

export interface ComponentContext {
  readonly runtime: RuntimeHandle;
  /** vgpu context — documented escape hatch (PLAN.md §9.4). `null` in fallback mode
   * (`caps.tier === 'fallback'`). A component that wants a fallback must construct its layers with
   * `gpu: ctx.gpu` and guard its own direct vgpu calls (`compute()`/`uniforms()`/`storage()`/…) —
   * those layers already tolerate `gpu: null`, but a raw vgpu call does not. */
  readonly gpu: Gpu | null;
  readonly surface: SurfaceLike;
  /** `null` in fallback mode — there is no shared uniform buffer without a `Gpu`. */
  readonly globals: SharedUniforms<Globals> | null;
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

  /** The viewport the component's own shaders read, for the Canvas2D backend to transform with
   * (PLAN.md §22, stage 3.5) — the GPU path passes viewport through a uniform buffer that doesn't
   * exist in fallback mode. Required for a component that wants a fallback; omitted, the
   * `Canvas2DScheduler` passes an identity viewport. */
  readonly viewportUniforms?: ViewportUniforms;
}
