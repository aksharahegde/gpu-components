import { effect, type Effect, type Gpu } from "vgpu";
import type { Canvas2DPassEncoder, PassEncoder } from "../passEncoder.ts";

/**
 * The Canvas2D fallback policy for a raster layer (PLAN.md §22.2's `RasterLayer` row:
 * "`putImageData` of a CPU-binned density field").
 *
 * Like `QuadFallbackPolicy`, this is the component's to supply and for the same reason: on the GPU
 * path the *shader* decides what the density buffer means and how it maps to colour, so `core`
 * knows only that there is a buffer. The component hands over the shading function; `core` owns
 * the pixel loop, the `ImageData` allocation and its reuse.
 */
export interface RasterFallbackPolicy {
  /**
   * Writes one frame's pixels into `rgba` (length `width * height * 4`, top-left origin). The CPU
   * equivalent of the fragment shader — including whatever CPU binning replaces the density compute
   * pass, since in fallback mode no dispatch ran to fill a density buffer.
   */
  shade(rgba: Uint8ClampedArray, width: number, height: number): void;
}

export interface RasterLayerOptions {
  readonly gpu: Gpu;
  /** WGSL source for a full-screen fragment shader — `effect(gpu, …)`'s own contract: one
   * `@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f` entry, no vertex stage of
   * its own. */
  readonly shader: string;
  readonly label?: string;
  /** Enables the Canvas2D backend. Omitted, a raster layer draws nothing in fallback mode and says
   * so through `pass.report()`. */
  readonly fallback?: RasterFallbackPolicy;
}

/**
 * PLAN.md §12.1's fourth core rendering primitive: "a texture drawn through `effect(gpu, …)` with a
 * colormap. Used for LOD density fields and heatmaps." **This wraps a `storage` buffer, not an
 * actual `GPUTexture`** — `effect(gpu, wgsl).set(values)` binds arbitrary named resources with the
 * same reflection-driven system `Draw`/`Compute` use (confirmed against vgpu's docs), so a fragment
 * shader can read a density/heatmap buffer directly. That sidesteps `texture_storage_2d` compute-
 * write format constraints, samplers, and `Capabilities.maxTextureDimension2D` sizing entirely — a
 * real texture is worth reaching for only if a future consumer needs texture-specific features
 * (mipmaps, hardware filtering) this doesn't provide.
 */
export class RasterLayer {
  private readonly effect: Effect;
  private readonly fallback: RasterFallbackPolicy | undefined;
  private readonly label: string | undefined;
  /** Reused across frames, reallocated only when the surface size changes — allocating an
   * `ImageData` per frame is the CPU-side version of the "don't create targets in the loop"
   * anti-pattern (PLAN.md §14.1b). */
  private image: ImageData | null = null;

  constructor(opts: RasterLayerOptions) {
    this.effect = effect(opts.gpu, opts.shader, { label: opts.label });
    this.fallback = opts.fallback;
    this.label = opts.label;
  }

  /** Binds a named resource the shader declares (uniforms, storage buffers) — same bind-by-name
   * convention as `InstancedQuadLayer.bind()`. */
  bind(values: Record<string, unknown>): void {
    this.effect.set(values);
  }

  /** Encodes the full-screen fragment pass against whichever backend the scheduler opened. */
  draw(pass: PassEncoder): void {
    if (pass.kind === "canvas2d") {
      this.drawCanvas2D(pass);
      return;
    }
    pass.frame.draw(this.effect);
  }

  /** No cap applies here: unlike the quad and line rows of PLAN.md §22.2's table, a raster fill is
   * bounded by the surface's pixel count, not by the dataset — which is exactly why the table marks
   * this row "full". */
  private drawCanvas2D(pass: Canvas2DPassEncoder): void {
    if (!this.fallback) {
      pass.report(`${this.label ?? "RasterLayer"}: no Canvas2D fallback policy — nothing drawn`);
      return;
    }
    const width = Math.max(1, Math.floor(pass.width));
    const height = Math.max(1, Math.floor(pass.height));
    if (!this.image || this.image.width !== width || this.image.height !== height) {
      this.image = pass.ctx.createImageData(width, height);
    }
    this.fallback.shade(this.image.data, width, height);
    pass.ctx.putImageData(this.image, 0, 0);
  }

  /** No-op — see `InstancedQuadLayer.dispose()`'s identical note: no `destroy()` on the underlying
   * `vgpu` resource's public interface; reclaimed when the owning `Gpu` disposes. */
  dispose(): void {}
}
