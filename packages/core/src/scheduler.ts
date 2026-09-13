import { clock, frameLoop, type Frame, type FrameLoopHandle, type Gpu, type SharedUniforms } from "vgpu";
import type { FrameContext, GpuComponent } from "./component.ts";
import { gpuPass } from "./passEncoder.ts";
import { createProfiler, type Profiler } from "./profiler.ts";
import type { SurfaceLike } from "./surface.ts";
import type { Globals } from "./uniforms.ts";

interface Mounted {
  readonly component: GpuComponent;
  readonly surface: SurfaceLike;
}

/**
 * Turns every mounted component into exactly one `frameLoop(gpu, …)` tick (PLAN.md §10.2). All
 * compute passes across all components run before any render pass — a component's own binning
 * kernel is guaranteed to land before any consumer's draw, and no component can only order itself.
 *
 * A component that is neither `dirty` nor `animating` contributes no passes and costs nothing:
 * `vgpu`'s `set()` performs no equality check, so gating writes is the scheduler's job, not vgpu's.
 *
 * The profiler attaches a `timer.span(name)` per render pass (PLAN.md §10.7/§28), so "which
 * component blew the budget" is answerable — transparently, with no component-side opt-in.
 */
export class FrameScheduler {
  private readonly gpu: Gpu;
  private readonly globals: SharedUniforms<Globals>;
  private readonly mounted = new Map<string, Mounted>();
  private handle: FrameLoopHandle | null = null;
  private readonly profilerRef: Profiler;

  constructor(gpu: Gpu, globals: SharedUniforms<Globals>, profiler: Profiler = createProfiler(gpu, false)) {
    this.gpu = gpu;
    this.globals = globals;
    this.profilerRef = profiler;
  }

  get profiler(): Profiler {
    return this.profilerRef;
  }

  mount(component: GpuComponent, surface: SurfaceLike): () => void {
    if (this.mounted.has(component.id)) {
      throw new Error(`gpu-components: a component with id "${component.id}" is already mounted`);
    }
    this.mounted.set(component.id, { component, surface });
    this.ensureRunning();
    return () => {
      this.mounted.delete(component.id);
    };
  }

  get mountedCount(): number {
    return this.mounted.size;
  }

  private ensureRunning(): void {
    if (this.handle) return;
    // ponytail: runs forever once started, even when every mounted component is settled and
    // clean — there is no wake path today (components flip `dirty`/`animating` from inside their
    // own update()/event handlers without telling the scheduler to restart a stopped loop), so a
    // naive stop-when-idle would stall the next component that dirties itself outside a mount
    // call. rAF is already throttled by browsers in background tabs, which covers most of the
    // real cost in practice. Revisit with a real wake signal (e.g. component-initiated
    // `ensureRunning()`) if idle GPU usage ever actually matters.
    this.handle = frameLoop(this.gpu, (frame) => this.tick(frame));
  }

  /** Stops the loop. Idempotent. Existing mounts are left in place — `mount()` restarts it. */
  stop(): void {
    this.handle?.stop();
    this.handle = null;
  }

  private tick(frame: Frame): void {
    const c = clock(this.gpu);

    const active = [...this.mounted.values()].filter(
      (m) => m.component.dirty || m.component.animating || m.surface.dirty,
    );
    if (active.length === 0) return;

    const dpr =
      typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
    this.globals.set({ time: c.time, deltaTime: c.deltaTime, dpr });

    const frameCtx: FrameContext = {
      time: c.time,
      deltaTime: c.deltaTime,
      frameCount: c.frameCount,
    };

    const cpuStart = performance.now();
    const plans = active.map((m) => ({ mounted: m, plan: m.component.plan(frameCtx) }));

    let dispatchCount = 0;
    for (const { plan } of plans) {
      for (const pass of plan.computePasses) {
        pass.dispatch();
        dispatchCount++;
      }
    }

    let passCount = 0;
    for (const { mounted, plan } of plans) {
      for (const pass of plan.renderPasses) {
        const target = pass.target === "surface" ? mounted.surface.surface : pass.target;
        // Qualified by component id, not just `pass.name` — e.g. every `TimelineComponent` names
        // its render pass "timeline", and `Timer.onResults` returns one flat `name -> ms` record,
        // so an unqualified name would silently collide with ≥2 components mounted.
        const timerSpan = this.profilerRef.span(`${mounted.component.id}:${pass.name}`);
        frame.pass({ target, clear: pass.clear, scissor: pass.scissor, timer: timerSpan }, (framePass) =>
          pass.encode(gpuPass(framePass)),
        );
        passCount++;
      }
      mounted.surface.clearDirty();
    }

    this.profilerRef.recordFrame({
      cpuMs: performance.now() - cpuStart,
      componentCount: active.length,
      passCount,
      dispatchCount,
    });
  }
}
