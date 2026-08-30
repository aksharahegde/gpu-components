import { draw, storage, type BlendPreset, type Draw, type FramePass, type Gpu, type StorageBuffer } from "vgpu";
import type { WarningsLog } from "../warnings.ts";

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
  /** PLAN.md §28.2's "buffers growing repeatedly" anti-pattern — reported from the *second* growth
   * onward (see `upload()`'s comment for why the first growth doesn't count). Optional: omit to skip
   * detection entirely, e.g. in a context with no `WarningsLog` to report into. */
  readonly warnings?: WarningsLog;
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
  private readonly warnings: WarningsLog | undefined;
  private growthCount = 0;

  constructor(opts: InstancedQuadLayerOptions) {
    this.gpu = opts.gpu;
    this.shader = opts.shader;
    this.stride = opts.instanceStride;
    this.blend = opts.blend ?? "alpha";
    this.label = opts.label;
    this.warnings = opts.warnings;
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

  /** The underlying per-instance storage buffer — an escape hatch for a compute pass (e.g. a
   * culling/binning kernel, PLAN.md §12.2) that needs to read the exact same instance data a
   * render pass draws, not a copy. Re-`.set()` it on the compute pipeline after every `upload()`
   * that might have grown the buffer (growth replaces the underlying `StorageBuffer` object). */
  get instances(): StorageBuffer {
    return this.buffer;
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
      const previousCapacity = this.capacity;
      this.capacity = count;
      this.buffer = storage(this.gpu, this.capacity * this.stride, "read");
      this.drawable.set({ instances: this.buffer });

      // The *first* growth is just "the initial capacity guess was a little off" — not a bug.
      // Repeated growth (the component's data keeps outgrowing what it presized) is the real
      // thrashing pattern PLAN.md §28.2 describes, so only the second growth onward is reported.
      this.growthCount++;
      if (this.growthCount >= 2) {
        this.warnings?.report({
          code: "buffer-growth",
          source: this.label ?? "InstancedQuadLayer",
          message: `capacity grew ${previousCapacity} -> ${this.capacity} — presize with \`capacity\``,
        });
      }
    }
    this.buffer.write(bytes);
    this.count = count;
  }

  /** Encodes the instanced draw against the frame pass the scheduler opened. A no-op at `count === 0`. */
  draw(pass: FramePass): void {
    if (this.count === 0) return;
    pass.draw(this.drawable, { instances: this.count });
  }

  /** GPU-driven draw: the GPU reads vertex/instance counts from `indirect` (written by a preceding
   * compute pass — PLAN.md §12.2's `binSpans`), so no CPU-side count round-trips. `indirect` must be
   * a buffer created with `storage(gpu, bytes, { indirect: true })`, holding the non-indexed
   * `drawIndirect` layout: `[vertexCount, instanceCount, firstVertex, firstInstance]`. */
  drawIndirect(pass: FramePass, indirect: StorageBuffer): void {
    pass.draw(this.drawable, { indirect });
  }

  /** No-op: `StorageBuffer`'s public interface has no `destroy()` (see `upload()`'s comment) — the
   * buffer is reclaimed when the owning `Gpu` disposes. Kept as an explicit method so a future
   * `core` release (or a version of `vgpu` that exposes disposal) has a stable place to add it,
   * and so callers don't need to know which is currently true. */
  dispose(): void {}
}
