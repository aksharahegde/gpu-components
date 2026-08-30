import { draw, storage, type BlendPreset, type Draw, type Gpu, type StorageBuffer } from "vgpu";
import type { WarningsLog } from "../warnings.ts";
import {
  CANVAS2D_CAPS,
  clipToPixelX,
  clipToPixelY,
  cssColor,
  samplingStride,
  type Canvas2DPassEncoder,
  type PassEncoder,
} from "../passEncoder.ts";
import type { ViewportUniforms } from "../viewport.ts";

/** A decoded quad in clip space, ready for the Canvas2D backend. */
export interface QuadRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Packed `0xRRGGBBAA`, as `packRgba8()` produces. */
  readonly color: number;
}

/**
 * The Canvas2D fallback policy for a quad layer (PLAN.md §16.1 assigns "its Canvas2D fallback
 * *policy*" to the component, not to `core`).
 *
 * This exists because a quad layer cannot decode its own instances: on the GPU path the component
 * supplies WGSL that interprets the bytes, so `core` only ever knows the stride, never the meaning.
 * A component that wants a fallback therefore hands over the one thing `core` cannot infer — how to
 * read one instance — and gets the entire Canvas2D backend, cap enforcement and degradation
 * reporting for free. A component that omits it renders nothing in fallback mode, loudly.
 */
export interface QuadFallbackPolicy {
  /** Decodes instance `index` from the CPU mirror into clip space, or `null` to skip it (the
   * fallback's equivalent of a culled instance). `viewport` carries the same scale/offset values
   * the shader reads, so both paths transform identically. */
  decode(view: DataView, index: number, viewport: ViewportUniforms): QuadRect | null;
}

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
  /** Enables the Canvas2D backend for this layer. Retaining the CPU mirror it needs costs
   * `capacity × stride` bytes, so it is opt-in rather than always-on — at 5M spans that is a real
   * amount of memory to hold for a path most sessions never take. */
  readonly fallback?: QuadFallbackPolicy;
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
  private readonly fallback: QuadFallbackPolicy | undefined;
  /** CPU mirror of the last `upload()`, retained only when a fallback policy is configured. This is
   * a partial step toward PLAN.md §14.1(c)'s mandatory mirror — device-loss replay still relies on
   * the component's own source of truth, not on this. */
  private mirror: DataView | null = null;

  constructor(opts: InstancedQuadLayerOptions) {
    this.gpu = opts.gpu;
    this.shader = opts.shader;
    this.stride = opts.instanceStride;
    this.blend = opts.blend ?? "alpha";
    this.label = opts.label;
    this.warnings = opts.warnings;
    this.fallback = opts.fallback;
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
    if (this.fallback) {
      // Copy, not a view onto the caller's buffer: callers reuse scratch buffers between uploads
      // (TimelineComponent's rule scratch does exactly this), so aliasing would leave the fallback
      // rendering whatever the next frame happened to write.
      const copy = new Uint8Array(count * this.stride);
      copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, count * this.stride));
      this.mirror = new DataView(copy.buffer);
    }
  }

  /** Encodes the instanced draw against whichever backend the scheduler opened. A no-op at
   * `count === 0`. */
  draw(pass: PassEncoder): void {
    if (this.count === 0) return;
    if (pass.kind === "canvas2d") {
      this.drawCanvas2D(pass, this.count);
      return;
    }
    pass.frame.draw(this.drawable, { instances: this.count });
  }

  /**
   * PLAN.md §22.2's `InstancedQuadLayer` row: "`fillRect` loop with batched `fillStyle` runs",
   * capped at ~50k quads/frame. Above the cap it samples at an even stride and reports, rather than
   * truncating to the first 50k — truncation would silently blank everything past a point on
   * screen, while sampling degrades density uniformly across the whole view.
   */
  private drawCanvas2D(pass: Canvas2DPassEncoder, count: number): void {
    if (!this.fallback || !this.mirror) {
      pass.report(
        `${this.label ?? "InstancedQuadLayer"}: no Canvas2D fallback policy — nothing drawn for ` +
          `${count} instances`,
      );
      return;
    }

    const stride = samplingStride(count, CANVAS2D_CAPS.quads);
    if (stride > 1) {
      pass.report(
        `${this.label ?? "InstancedQuadLayer"}: ${count} quads exceeds the Canvas2D budget of ` +
          `${CANVAS2D_CAPS.quads} — drawing every ${stride}th`,
      );
    }

    const { ctx, width, height, viewport } = pass;
    let lastColor = -1;
    for (let i = 0; i < count; i += stride) {
      const rect = this.fallback.decode(this.mirror, i, viewport);
      if (!rect) continue;
      if (rect.color !== lastColor) {
        ctx.fillStyle = cssColor(rect.color);
        lastColor = rect.color;
      }
      const x = clipToPixelX(rect.x0, width);
      const y = clipToPixelY(rect.y1, height); // clip y is +1 at the top, so y1 is the top edge
      const w = Math.max(1, clipToPixelX(rect.x1, width) - x);
      const h = Math.max(1, clipToPixelY(rect.y0, height) - y);
      ctx.fillRect(x, y, w, h);
    }
  }

  /** GPU-driven draw: the GPU reads vertex/instance counts from `indirect` (written by a preceding
   * compute pass — PLAN.md §12.2's `binSpans`), so no CPU-side count round-trips. `indirect` must be
   * a buffer created with `storage(gpu, bytes, { indirect: true })`, holding the non-indexed
   * `drawIndirect` layout: `[vertexCount, instanceCount, firstVertex, firstInstance]`. */
  drawIndirect(pass: PassEncoder, indirect: StorageBuffer): void {
    if (pass.kind === "canvas2d") {
      // The whole point of an indirect draw is that the count lives on the GPU and never round-trips
      // (PLAN.md §12.2). With no GPU there is no such count, so the fallback falls back further: draw
      // every uploaded instance and let `decode()` cull. That is the CPU equivalent of what the
      // culling kernel was doing, which is exactly what §22.2's "compute passes → CPU equivalents"
      // row anticipates.
      this.drawCanvas2D(pass, this.count);
      return;
    }
    pass.frame.draw(this.drawable, { indirect });
  }

  /** No-op: `StorageBuffer`'s public interface has no `destroy()` (see `upload()`'s comment) — the
   * buffer is reclaimed when the owning `Gpu` disposes. Kept as an explicit method so a future
   * `core` release (or a version of `vgpu` that exposes disposal) has a stable place to add it,
   * and so callers don't need to know which is currently true. */
  dispose(): void {}
}
