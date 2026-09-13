import type { FrameContext, GpuComponent } from "./component.ts";
import type { Canvas2DSurface } from "./canvas2dSurface.ts";
import { createProfiler, type Profiler } from "./profiler.ts";
import type { WarningsLog } from "./warnings.ts";
import type { ViewportUniforms } from "./viewport.ts";
import type { ClearColor } from "vgpu";

interface Mounted {
  readonly component: GpuComponent;
  readonly surface: Canvas2DSurface;
}

/** `vgpu`'s `ClearColor` is either `readonly [r,g,b,a]` or a `GPUColorDict` (`{r,g,b,a}`) — both
 * 0-1 floats. Normalized to a CSS `rgba()` string so the runtime's `clearColor` option paints the
 * same background on both backends (PLAN.md §22, stage 3.5: "so fallback isn't transparent where
 * GPU is `#f7fbfd`"). */
function cssColorFromClearColor(clear: ClearColor): string {
  const [r, g, b, a] = Array.isArray(clear)
    ? clear
    : [(clear as GPUColorDict).r, (clear as GPUColorDict).g, (clear as GPUColorDict).b, (clear as GPUColorDict).a];
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

const IDENTITY_VIEWPORT: ViewportUniforms = {
  timeToClip: [1, 0],
  trackToClip: [1, 0],
  pxSize: [1, 1],
};

/**
 * `FrameScheduler`'s Canvas2D sibling (PLAN.md §22, stage 3.5) — same tick shape (all compute
 * passes across every mount dispatch before any render pass encodes), driven by
 * `requestAnimationFrame` directly rather than `vgpu`'s `frameLoop`/`clock`, since there is no
 * `Gpu` to drive either of those from.
 */
export class Canvas2DScheduler {
  private readonly mounted = new Map<string, Mounted>();
  private readonly warnings: WarningsLog;
  private readonly clearColor: ClearColor | undefined;
  private readonly profilerRef: Profiler;
  private rafHandle: ReturnType<typeof setTimeout> | number | null = null;
  private frameCount = 0;
  private lastTime: number | null = null;

  constructor(warnings: WarningsLog, clearColor?: ClearColor) {
    this.warnings = warnings;
    this.clearColor = clearColor;
    this.profilerRef = createProfiler(null, false);
  }

  get profiler(): Profiler {
    return this.profilerRef;
  }

  get mountedCount(): number {
    return this.mounted.size;
  }

  mount(component: GpuComponent, surface: Canvas2DSurface): () => void {
    if (this.mounted.has(component.id)) {
      throw new Error(`gpu-components: a component with id "${component.id}" is already mounted`);
    }
    this.mounted.set(component.id, { component, surface });
    this.ensureRunning();
    return () => {
      this.mounted.delete(component.id);
    };
  }

  /** `requestAnimationFrame` where available, falling back to a 16ms `setTimeout` where it isn't
   * (Node, no DOM) — the same fallback `vgpu`'s own `frameLoop` uses (see
   * `@gpuc/testing`'s `tick()` doc comment), so this scheduler is unit-testable under
   * plain Node without a jsdom `window`. */
  private scheduleFrame(cb: (now: number) => void): ReturnType<typeof setTimeout> | number {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
    return setTimeout(() => cb(performance.now()), 16);
  }

  private cancelFrame(handle: ReturnType<typeof setTimeout> | number): void {
    if (typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle as number);
    } else {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  }

  private ensureRunning(): void {
    if (this.rafHandle != null) return;
    this.rafHandle = this.scheduleFrame(this.loop);
  }

  private readonly loop = (now: number): void => {
    this.rafHandle = this.scheduleFrame(this.loop);
    this.tick(now);
  };

  /** Idempotent — safe to call twice (StrictMode double-mount). */
  stop(): void {
    if (this.rafHandle != null) this.cancelFrame(this.rafHandle);
    this.rafHandle = null;
  }

  private tick(now: number): void {
    const deltaTime = this.lastTime == null ? 0 : now - this.lastTime;
    this.lastTime = now;
    this.frameCount++;

    const active = [...this.mounted.values()].filter(
      (m) => m.component.dirty || m.component.animating || m.surface.dirty,
    );
    if (active.length === 0) return;

    const frameCtx: FrameContext = { time: now, deltaTime, frameCount: this.frameCount };

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
      const { ctx, width, height } = mounted.surface;
      const viewport = mounted.component.viewportUniforms ?? IDENTITY_VIEWPORT;
      const report = (reason: string): void => {
        this.warnings.report({ code: "canvas2d-degraded", source: mounted.component.id, message: reason });
      };

      for (const pass of plan.renderPasses) {
        if (pass.target !== "surface") {
          report(`render pass "${pass.name}" targets an off-screen surface — no Canvas2D equivalent, skipped`);
          continue;
        }
        if (pass.clear) {
          ctx.clearRect(0, 0, width, height);
          if (this.clearColor) {
            ctx.fillStyle = cssColorFromClearColor(this.clearColor);
            ctx.fillRect(0, 0, width, height);
          }
        }
        ctx.save();
        pass.encode({ kind: "canvas2d", ctx, width, height, viewport, report });
        ctx.restore();
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
