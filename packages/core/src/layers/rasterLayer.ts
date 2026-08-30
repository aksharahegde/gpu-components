import { effect, type Effect, type FramePass, type Gpu } from "vgpu";

export interface RasterLayerOptions {
  readonly gpu: Gpu;
  /** WGSL source for a full-screen fragment shader — `effect(gpu, …)`'s own contract: one
   * `@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f` entry, no vertex stage of
   * its own. */
  readonly shader: string;
  readonly label?: string;
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

  constructor(opts: RasterLayerOptions) {
    this.effect = effect(opts.gpu, opts.shader, { label: opts.label });
  }

  /** Binds a named resource the shader declares (uniforms, storage buffers) — same bind-by-name
   * convention as `InstancedQuadLayer.bind()`. */
  bind(values: Record<string, unknown>): void {
    this.effect.set(values);
  }

  /** Encodes the full-screen fragment pass against the frame pass the scheduler opened. */
  draw(pass: FramePass): void {
    pass.draw(this.effect);
  }

  /** No-op — see `InstancedQuadLayer.dispose()`'s identical note: no `destroy()` on the underlying
   * `vgpu` resource's public interface; reclaimed when the owning `Gpu` disposes. */
  dispose(): void {}
}
