import { clock, frameLoop, type Frame, type FrameLoopHandle, type Gpu, type SharedUniforms } from "vgpu";
import type { FrameContext, GpuComponent } from "./component.ts";
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
 */
export class FrameScheduler {
  private readonly gpu: Gpu;
  private readonly globals: SharedUniforms<Globals>;
  private readonly mounted = new Map<string, Mounted>();
  private handle: FrameLoopHandle | null = null;

  constructor(gpu: Gpu, globals: SharedUniforms<Globals>) {
    this.gpu = gpu;
    this.globals = globals;
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
    this.handle = frameLoop(this.gpu, (frame) => this.tick(frame));
  }

  /** Stops the loop. Idempotent. Existing mounts are left in place — `mount()` restarts it. */
  stop(): void {
    this.handle?.stop();
    this.handle = null;
  }

  private tick(frame: Frame): void {
    const c = clock(this.gpu);
    const dpr =
      typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
    this.globals.set({ time: c.time, deltaTime: c.deltaTime, dpr });

    const frameCtx: FrameContext = {
      time: c.time,
      deltaTime: c.deltaTime,
      frameCount: c.frameCount,
    };

    const active = [...this.mounted.values()].filter(
      (m) => m.component.dirty || m.component.animating,
    );
    if (active.length === 0) return;

    const plans = active.map((m) => ({ mounted: m, plan: m.component.plan(frameCtx) }));

    for (const { plan } of plans) {
      for (const pass of plan.computePasses) pass.dispatch();
    }

    for (const { mounted, plan } of plans) {
      for (const pass of plan.renderPasses) {
        const target = pass.target === "surface" ? mounted.surface.surface : pass.target;
        frame.pass({ target, clear: pass.clear, scissor: pass.scissor }, (framePass) =>
          pass.encode(framePass),
        );
      }
      mounted.surface.clearDirty();
    }
  }
}
