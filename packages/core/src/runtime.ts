import { init, initFromDevice, uniforms, type ClearColor, type Gpu, type SharedUniforms, type SurfaceOptions } from "vgpu";
import { NO_WEBGPU_CAPABILITIES, probeCapabilities, supportedFeatures, type Capabilities } from "./capabilities.ts";
import type { ComponentContext, GpuComponent, RuntimeHandle } from "./component.ts";
import { createProfiler, DISABLED_PROFILER, type Profiler } from "./profiler.ts";
import { ResourceRegistry } from "./registry.ts";
import { FrameScheduler } from "./scheduler.ts";
import { createWarningsLog, type WarningsLog } from "./warnings.ts";
import { SurfaceHandle } from "./surface.ts";
import type { Globals } from "./uniforms.ts";

export interface GpuRuntimeOptions {
  /** Adopt a device another library already owns, via `initFromDevice`. Device-loss recovery is
   * the adopting library's responsibility, not ours — we never re-`init()` an adopted device. */
  readonly adopt?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
  /** Requests `timestamp-query` if the probed adapter actually supports it. Ignored when `adopt` is set. */
  readonly profiling?: boolean;
  readonly fps?: number;
  /**
   * Default clear color for every surface this runtime registers, as vgpu's `[r, g, b, a]` in the
   * 0–1 range. A component's own `surfaceOpts.clearColor` still wins.
   *
   * Left unset, vgpu clears to opaque black — which is invisible against a dark page and a hard
   * black slab against a light one. Since one runtime owns every canvas on the page, this is the
   * one place a host can say "GPU surfaces are this colour" and have every component agree.
   */
  readonly clearColor?: ClearColor;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  readonly onRecovered?: () => void;
  /** Test-only: overrides how `create()` gets its `Gpu` + `Capabilities`, bypassing the browser
   * `navigator.gpu` probe and `init()` entirely. `@gpu-components/testing`'s mock runtime uses
   * this so code that calls `GpuRuntime.create()` itself (e.g. `<GPUProvider>`, which cannot be
   * pointed at `createWithGpu()`) can still reach `caps.webgpu === true` under `vgpu/mock`. Also
   * `recover()`'s default reconnect strategy, unless `reconnect` overrides it separately. */
  readonly connect?: () => Promise<{ gpu: Gpu; caps: Capabilities }>;
  /** How `recover()` gets a fresh `Gpu` + `Capabilities` after device loss, if different from
   * `connect`. Defaults to `connect`, and beyond that to the browser probe-then-`init()` path. */
  readonly reconnect?: () => Promise<{ gpu: Gpu; caps: Capabilities }>;
}

export interface MountHandle {
  unmount(): void;
}

interface MountRecord {
  readonly component: GpuComponent;
  readonly canvas: HTMLCanvasElement;
  readonly surfaceOpts: SurfaceOptions | undefined;
  readonly disposers: Array<() => void>;
}

const RECOVERY_BACKOFF_MS = [250, 500, 1000, 2000, 4000];

/**
 * Root runtime object (PLAN.md §10.1) — one `Gpu`, the registry of mounted components, surfaces,
 * scheduler, shared uniforms, and capabilities. One per `<GPUProvider>`.
 *
 * `caps.webgpu === false` is a *state*, not a thrown error: `create()` never rejects because
 * WebGPU is unsupported, so callers render a fallback instead of catching.
 *
 * Device loss is entirely our problem — `vgpu` does not recover a lost device (PLAN.md §10.6). On
 * loss we dispose everything gpu-owned, re-`init()` with backoff, recreate every tracked surface,
 * and replay `create()` (then `onContextRestored()`) on every still-mounted component so it
 * re-derives its GPU state from its own CPU-side source of truth. A component never sees the loss
 * beyond that hook.
 */
export class GpuRuntime implements RuntimeHandle {
  private gpuRef: Gpu | null;
  caps: Capabilities;
  private scheduler: FrameScheduler | null;
  private globalsRef: SharedUniforms<Globals> | null;
  registry: ResourceRegistry;
  /** PLAN.md §28.2 — a plain log, not GPU state, so (unlike `profiler`) it's created once and
   * persists across device-loss recovery rather than being rebuilt per-`Gpu`. */
  readonly warnings: WarningsLog = createWarningsLog();

  private readonly surfaces = new Map<HTMLCanvasElement, SurfaceHandle>();
  private readonly mounts = new Map<string, MountRecord>();
  private readonly options: GpuRuntimeOptions;
  private _disposed = false;
  private recovering = false;

  private constructor(
    gpu: Gpu | null,
    caps: Capabilities,
    scheduler: FrameScheduler | null,
    globals: SharedUniforms<Globals> | null,
    registry: ResourceRegistry,
    options: GpuRuntimeOptions,
  ) {
    this.gpuRef = gpu;
    this.caps = caps;
    this.scheduler = scheduler;
    this.globalsRef = globals;
    this.options = options;
    this.registry = registry;
    if (this.gpuRef) this.watchDeviceLoss(this.gpuRef);
  }

  static async create(options: GpuRuntimeOptions = {}): Promise<GpuRuntime> {
    const registry = new ResourceRegistry();

    if (options.adopt) {
      const gpu = await initFromDevice(options.adopt);
      const caps = await probeCapabilities();
      const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
      // `caps.timestampQuery` reflects the *adapter's* probed capability, not necessarily what the
      // externally-owned adopted device actually had requested when it was created — conservative
      // false here rather than risking `timer(gpu)`'s `VGPU-TIMER-INVALID` on a device we don't
      // control. CPU frame stats still work regardless (`createProfiler`'s own doc comment).
      const scheduler = new FrameScheduler(gpu, globals, createProfiler(gpu, false));
      return new GpuRuntime(gpu, caps, scheduler, globals, registry, options);
    }

    if (options.connect) {
      const { gpu, caps } = await options.connect();
      const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
      const scheduler = new FrameScheduler(gpu, globals, createProfiler(gpu, GpuRuntime.gpuTimingFor(caps, options)));
      return new GpuRuntime(gpu, caps, scheduler, globals, registry, options);
    }

    const caps = await probeCapabilities();
    if (!caps.webgpu) {
      return new GpuRuntime(null, NO_WEBGPU_CAPABILITIES, null, null, registry, options);
    }

    const gpu = await GpuRuntime.initGpu(caps, options);
    const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
    const scheduler = new FrameScheduler(gpu, globals, createProfiler(gpu, GpuRuntime.gpuTimingFor(caps, options)));
    return new GpuRuntime(gpu, caps, scheduler, globals, registry, options);
  }

  /** Whether `timer(gpu)` GPU timing should actually be turned on — `options.profiling` opted in
   * *and* `caps.timestampQuery` confirms the feature was actually granted (`initGpu` only requests
   * it when `profiling` is set, via `supportedFeatures`, so this stays consistent with what was
   * actually asked for at `init()` time). */
  private static gpuTimingFor(caps: Capabilities, options: GpuRuntimeOptions): boolean {
    return options.profiling === true && caps.timestampQuery;
  }

  /**
   * Escape hatch for callers that already hold a `Gpu` (chiefly `@gpu-components/testing`, which
   * builds one from `vgpu/mock`'s `createMockAdapter` — there is no `navigator.gpu` to probe under
   * Node). Skips capability probing and `init()`; `caps` is taken as given. Still wires up
   * device-loss recovery, so a mock device's `.destroy()` exercises the same recovery path a real
   * lost device would.
   */
  static createWithGpu(gpu: Gpu, caps: Capabilities, options: GpuRuntimeOptions = {}): GpuRuntime {
    const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
    const scheduler = new FrameScheduler(gpu, globals, createProfiler(gpu, GpuRuntime.gpuTimingFor(caps, options)));
    return new GpuRuntime(gpu, caps, scheduler, globals, new ResourceRegistry(), options);
  }

  private static initGpu(caps: Capabilities, options: GpuRuntimeOptions): Promise<Gpu> {
    const requiredFeatures = options.profiling ? supportedFeatures(caps) : [];
    return init({ powerPreference: options.powerPreference, requiredFeatures });
  }

  private watchDeviceLoss(gpu: Gpu): void {
    // Defensive, matching vgpu's own `Device` constructor: a mock/test device may not implement
    // the standard `GPUDevice.lost` promise at all.
    const lost = gpu.gpu.lost;
    if (!lost || typeof lost.then !== "function") return;
    void lost.then((info) => this.handleDeviceLost(gpu, info));
  }

  private handleDeviceLost(gpu: Gpu, info: GPUDeviceLostInfo): void {
    if (this._disposed || this.gpuRef !== gpu) return;
    this.options.onDeviceLost?.(info);
    if (!this.options.adopt) void this.recover();
  }

  /**
   * Test-only: drives the exact recovery path `watchDeviceLoss` would on a real lost device.
   * Exists because `vgpu/mock`'s device does not implement `GPUDevice.lost` — there is nothing
   * for a mock test to actually lose.
   */
  simulateDeviceLoss(info: GPUDeviceLostInfo = { reason: "unknown", message: "simulated" } as GPUDeviceLostInfo): void {
    if (!this.gpuRef) return;
    this.handleDeviceLost(this.gpuRef, info);
  }

  private async recover(): Promise<void> {
    if (this.recovering || this._disposed) return;
    this.recovering = true;

    this.scheduler?.stop();
    for (const surface of this.surfaces.values()) surface.dispose();
    this.surfaces.clear();
    this.registry.dispose();
    this.registry = new ResourceRegistry();
    this.gpuRef = null;
    this.caps = NO_WEBGPU_CAPABILITIES;
    this.globalsRef = null;
    this.scheduler = null;

    const reconnect =
      this.options.reconnect ??
      this.options.connect ??
      (async () => {
        const caps = await probeCapabilities();
        if (!caps.webgpu) throw new Error("gpu-components: no adapter available during recovery");
        const gpu = await GpuRuntime.initGpu(caps, this.options);
        return { gpu, caps };
      });

    for (const attemptDelay of RECOVERY_BACKOFF_MS) {
      if (this._disposed) return;
      try {
        const { gpu, caps } = await reconnect();
        this.gpuRef = gpu;
        this.caps = caps;
        this.globalsRef = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
        this.scheduler = new FrameScheduler(
          gpu,
          this.globalsRef,
          createProfiler(gpu, GpuRuntime.gpuTimingFor(caps, this.options)),
        );
        this.watchDeviceLoss(gpu);
        this.replayMounts();
        this.recovering = false;
        this.options.onRecovered?.();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, attemptDelay));
      }
    }
    this.recovering = false;
  }

  private replayMounts(): void {
    for (const record of this.mounts.values()) {
      for (const disposer of record.disposers.splice(0)) disposer();
      const surface = this.getOrCreateSurface(record.canvas, record.surfaceOpts);
      const ctx = this.buildContext(record.component.id, surface, record.disposers);
      record.component.create(ctx);
      record.component.onContextRestored?.();
      this.scheduler?.mount(record.component, surface);
    }
  }

  private getOrCreateSurface(canvas: HTMLCanvasElement, opts?: SurfaceOptions): SurfaceHandle {
    if (!this.gpuRef) {
      throw new Error("gpu-components: cannot register a surface — caps.webgpu is false");
    }
    const existing = this.surfaces.get(canvas);
    if (existing) return existing;
    // Runtime-wide default, overridable per surface. Coalesced rather than spread-ordered: an
    // `opts` that carries an explicit `clearColor: undefined` key would clobber the default under
    // `{ clearColor: default, ...opts }`, since spreading copies present-but-undefined keys.
    const merged: SurfaceOptions | undefined =
      this.options.clearColor === undefined
        ? opts
        : { ...opts, clearColor: opts?.clearColor ?? this.options.clearColor };
    const handle = new SurfaceHandle(this.gpuRef, canvas, merged);
    this.surfaces.set(canvas, handle);
    return handle;
  }

  private buildContext(
    componentId: string,
    surface: SurfaceHandle,
    disposers: Array<() => void>,
  ): ComponentContext {
    if (!this.gpuRef || !this.globalsRef) {
      throw new Error(`gpu-components: cannot build a context for "${componentId}" — no active gpu`);
    }
    return {
      runtime: this,
      gpu: this.gpuRef,
      surface,
      globals: this.globalsRef,
      registry: this.registry,
      caps: this.caps,
      onDispose: (fn) => disposers.push(fn),
    };
  }

  /** The `vgpu` context — documented escape hatch (PLAN.md §9.4, §10.1). `null` when
   * `caps.webgpu` is false, or transiently while recovering from device loss. */
  get gpu(): Gpu | null {
    return this.gpuRef;
  }

  /** PLAN.md §10.1/§10.7 — GPU timing + frame stats. `DISABLED_PROFILER` (not an error) when
   * `caps.webgpu` is false or transiently while recovering from device loss, matching `gpu`'s own
   * null-during-recovery contract. */
  /**
   * How many components are mounted on this runtime right now.
   *
   * Distinct from `profiler.lastFrame.componentCount`, which counts only the components that were
   * *dirty or animating* on the last tick — a settled component is skipped entirely, and a tick
   * with nothing to do returns before recording a frame at all. Callers that want "how many
   * components does this one device serve" want this; callers that want "how much work did the
   * last frame actually do" want the profiler.
   */
  get mountedCount(): number {
    return this.scheduler?.mountedCount ?? 0;
  }

  get profiler(): Profiler {
    return this.scheduler?.profiler ?? DISABLED_PROFILER;
  }

  registerSurface(canvas: HTMLCanvasElement, opts?: SurfaceOptions): SurfaceHandle {
    return this.getOrCreateSurface(canvas, opts);
  }

  unregisterSurface(canvas: HTMLCanvasElement): void {
    const handle = this.surfaces.get(canvas);
    if (!handle) return;
    handle.dispose();
    this.surfaces.delete(canvas);
  }

  /** Creates the component's context, calls `create()`, and mounts it into the scheduler. The
   * component is torn down (registered disposers, then `dispose()`) on `MountHandle.unmount()`
   * and is transparently replayed across a device-loss recovery until then. */
  mount(
    factory: (ctx: ComponentContext) => GpuComponent,
    canvas: HTMLCanvasElement,
    surfaceOpts?: SurfaceOptions,
  ): MountHandle {
    if (!this.gpuRef || !this.scheduler) {
      throw new Error("gpu-components: cannot mount a component — caps.webgpu is false");
    }
    const surface = this.getOrCreateSurface(canvas, surfaceOpts);
    const disposers: Array<() => void> = [];
    const probeCtx = this.buildContext("<pending>", surface, disposers);
    const component = factory(probeCtx);

    if (this.mounts.has(component.id)) {
      throw new Error(`gpu-components: a component with id "${component.id}" is already mounted`);
    }
    component.create(probeCtx);
    const record: MountRecord = { component, canvas, surfaceOpts, disposers };
    this.mounts.set(component.id, record);
    const unmountFromScheduler = this.scheduler.mount(component, surface);

    return {
      unmount: () => {
        unmountFromScheduler();
        this.mounts.delete(component.id);
        for (const disposer of record.disposers.splice(0)) disposer();
        component.dispose();
      },
    };
  }

  /** Wakes the scheduler by marking every registered surface dirty. Components mark themselves
   * dirty from `update()`; this exists for external invalidation. */
  invalidate(_reason?: string): void {
    for (const surface of this.surfaces.values()) surface.markDirty();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.scheduler?.stop();
    for (const record of this.mounts.values()) {
      for (const disposer of record.disposers.splice(0)) disposer();
      record.component.dispose();
    }
    this.mounts.clear();
    for (const surface of this.surfaces.values()) surface.dispose();
    this.surfaces.clear();
    this.registry.dispose();
    this.gpuRef?.dispose();
  }
}
