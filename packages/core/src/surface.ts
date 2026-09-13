import { surface as vgpuSurface, type Gpu, type Surface, type SurfaceOptions, type Target } from "vgpu";

/**
 * What `FrameScheduler` actually needs from a mounted component's surface: a resize-driven target
 * for `RenderPass.target === 'surface'`, and a dirty flag it consumes each tick. Kept as an
 * interface (not the concrete `SurfaceHandle` class) so `@gpuc/testing` can mount
 * components against a synthetic `Target` (e.g. an offscreen `target()`) without a real
 * `HTMLCanvasElement` — there is no canvas-surface mock in `vgpu/mock`.
 */
export interface SurfaceLike {
  readonly surface: Target;
  readonly dirty: boolean;
  clearDirty(): void;
  markDirty(): void;
}

/**
 * Wraps a `vgpu` `Surface` and enforces the reentrancy rule from PLAN.md §11.2: `onResize` is
 * subscribed once, here, outside any `frame()` call (subscribing fires immediately, and `vgpu`
 * throws `VGPU-FRAME-REENTRANT` for a `frame()` opened from inside a resize callback). The handler
 * below only records a size and marks the surface dirty for the *next* scheduler tick — it must
 * never encode or submit a frame itself.
 */
export class SurfaceHandle implements SurfaceLike {
  readonly surface: Surface;
  #dirty = true;
  readonly #unsubscribeResize: () => void;

  constructor(gpu: Gpu, canvas: HTMLCanvasElement, opts?: SurfaceOptions) {
    this.surface = vgpuSurface(gpu, canvas, opts);
    this.#unsubscribeResize = this.surface.onResize(() => {
      this.#dirty = true;
    });
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  /** Called by the scheduler once it has consumed the resize for this tick. */
  clearDirty(): void {
    this.#dirty = false;
  }

  markDirty(): void {
    this.#dirty = true;
  }

  dispose(): void {
    this.#unsubscribeResize();
    this.surface.dispose();
  }
}
