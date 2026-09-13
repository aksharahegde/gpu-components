/**
 * The Canvas2D fallback's counterpart to `SurfaceHandle` (PLAN.md §22, stage 3.4). Deliberately
 * does NOT implement `SurfaceLike` — that interface's `surface: Target` member is a `vgpu` concept
 * with no Canvas2D equivalent, and faking one would be a lying member, not an abstraction.
 * `Canvas2DScheduler` (a sibling to `FrameScheduler`, not a drop-in) knows the difference.
 */
export class Canvas2DSurface {
  readonly ctx: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  #dirty = true;
  #width = 0;
  #height = 0;
  #disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // A canvas that previously held a "webgpu" context can never yield a "2d" one afterward —
      // the browser's one-way door (PLAN.md §22's device-loss note). If this throws for a live
      // mount, the caller needs a fresh `<canvas>` element (see GPUTimeline's `key` prop), not a
      // retry against this one.
      throw new Error("gpu-components: canvas.getContext('2d') returned null — cannot build a Canvas2D fallback surface");
    }
    this.ctx = ctx;
    this.resize();
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  clearDirty(): void {
    this.#dirty = false;
  }

  markDirty(): void {
    this.#dirty = true;
  }

  /** CSS pixels — matches `Canvas2DPassEncoder.width/height`'s contract. */
  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  /** Sets `canvas.width`/`height` from its client rect × devicePixelRatio, and pre-scales the 2D
   * context so every subsequent draw call operates in CSS pixels — the same contract
   * `Canvas2DPassEncoder`'s doc comment promises ("the context is expected to be pre-scaled for
   * DPR by whoever opened the pass"). Marks the surface dirty so the next tick redraws at the new
   * size. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
    const width = Math.max(1, Math.round(rect.width || this.canvas.width || 1));
    const height = Math.max(1, Math.round(rect.height || this.canvas.height || 1));
    const deviceWidth = Math.max(1, Math.round(width * dpr));
    const deviceHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== deviceWidth || this.canvas.height !== deviceHeight) {
      this.canvas.width = deviceWidth;
      this.canvas.height = deviceHeight;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#width = width;
    this.#height = height;
    this.#dirty = true;
  }

  /** Idempotent — safe under StrictMode's double-mount/unmount. */
  dispose(): void {
    this.#disposed = true;
  }

  get disposed(): boolean {
    return this.#disposed;
  }
}
