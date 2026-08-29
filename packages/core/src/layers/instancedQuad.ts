import { draw, storage, type BlendPreset, type Draw, type FramePass, type Gpu, type StorageBuffer } from "vgpu";

export interface InstancedQuadLayerOptions {
  readonly gpu: Gpu;
  /** WGSL source declaring a `viewport` uniform and an `instances` storage array — bound by name,
   * reflected from the shader (PLAN.md §9.4: "we never hand-write a bind group layout"). */
  readonly shader: string;
  /** Bytes per instance in `instances`. Must match the WGSL struct's size exactly. */
  readonly instanceStride: number;
  /** Initial capacity, in instances. `upload()` grows the backing buffer if a later count exceeds it. */
  readonly capacity: number;
  readonly blend?: BlendPreset;
  readonly label?: string;
}

/**
 * The workhorse rendering primitive (PLAN.md §12.1): per-instance attributes in a `storage` buffer,
 * one `draw()` with `vertices: 6` (two triangles, no vertex buffers — the vertex shader spawns them
 * from `@builtin(vertex_index)`) and `instances: N`. Reusable across components — `GPUHeatmap`
 * (phase 5) is the acceptance test for that reuse (PLAN.md §29).
 */
export class InstancedQuadLayer {
  private readonly gpu: Gpu;
  private readonly shader: string;
  private readonly stride: number;
  private readonly blend: BlendPreset | undefined;
  private readonly label: string | undefined;
  private buffer: StorageBuffer;
  private capacity: number;
  private readonly drawable: Draw;
  private count = 0;

  constructor(opts: InstancedQuadLayerOptions) {
    this.gpu = opts.gpu;
    this.shader = opts.shader;
    this.stride = opts.instanceStride;
    this.blend = opts.blend ?? "alpha";
    this.label = opts.label;
    this.capacity = Math.max(1, opts.capacity);
    this.buffer = storage(this.gpu, this.capacity * this.stride, "read");
    this.drawable = draw(this.gpu, {
      shader: this.shader,
      vertices: 6,
      blend: this.blend,
      label: this.label,
    });
    this.drawable.set({ instances: this.buffer });
  }

  /** Binds the shared (or component-owned) viewport uniform block by its WGSL name. */
  bindViewport(uniforms: unknown): void {
    this.drawable.set({ viewport: uniforms });
  }

  /** Binds any other named resource the shader declares (a colormap texture, a selection mask, …). */
  bind(values: Record<string, unknown>): void {
    this.drawable.set(values);
  }

  /** Writes `count` instances' worth of `bytes` into the storage buffer, growing it first if
   * `count` exceeds the current capacity. */
  upload(bytes: ArrayBufferView<ArrayBuffer>, count: number): void {
    if (count > this.capacity) {
      // `StorageBuffer`'s public interface has no `destroy()` — per `vgpu`'s own docs, a storage
      // buffer "is destroyed by gpu.dispose() — or earlier, by hand, through the internal handle"
      // (storage.d.ts), and that internal handle isn't part of the type this factory returns. The
      // superseded buffer is reclaimed when the runtime's `Gpu` disposes, same as every other
      // resource `core` doesn't explicitly track through `ResourceRegistry`. Growth is rare in
      // practice — capacity is sized from the first `upload()`'s span count.
      this.capacity = count;
      this.buffer = storage(this.gpu, this.capacity * this.stride, "read");
      this.drawable.set({ instances: this.buffer });
    }
    this.buffer.write(bytes);
    this.count = count;
  }

  /** Encodes the instanced draw against the frame pass the scheduler opened. A no-op at `count === 0`. */
  draw(pass: FramePass): void {
    if (this.count === 0) return;
    pass.draw(this.drawable, { instances: this.count });
  }

  /** No-op: `StorageBuffer`'s public interface has no `destroy()` (see `upload()`'s comment) — the
   * buffer is reclaimed when the owning `Gpu` disposes. Kept as an explicit method so a future
   * `core` release (or a version of `vgpu` that exposes disposal) has a stable place to add it,
   * and so callers don't need to know which is currently true. */
  dispose(): void {}
}
