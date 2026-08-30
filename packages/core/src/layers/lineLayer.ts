import type { BlendPreset, Gpu, StorageBuffer } from "vgpu";
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
import { InstancedQuadLayer } from "./instancedQuad.ts";
import { LINE_WGSL } from "./lineLayer.wgsl.ts";

/** Bytes per `LineInstance`. Must stay in lockstep with the WGSL struct in `lineLayer.wgsl.ts`. */
export const LINE_INSTANCE_STRIDE = 32;

/** `LineInstance.flags` bits. Default (0) treats both endpoints as domain coordinates. */
export const LINE_FLAG_CLIP_X = 1;
export const LINE_FLAG_CLIP_Y = 2;

export interface LineInstance {
  /** Start point. Domain coordinates (x = time, y = track row) unless the matching flag is set. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Thickness in CSS pixels, constant under zoom — the reason this is a distinct primitive from a
   * quad. Clamped to a 1px floor in the shader so a hairline never vanishes. */
  readonly widthPx: number;
  /** Packed RGBA8, `0xRRGGBBAA`. Use `packRgba8()` rather than writing the literal by hand. */
  readonly color: number;
  /** `LINE_FLAG_CLIP_X` / `LINE_FLAG_CLIP_Y`, OR'd. Omit for plain domain-space endpoints. */
  readonly flags?: number;
}

export interface LineLayerOptions {
  readonly gpu: Gpu;
  /** Initial capacity, in lines. Grows on demand like any `InstancedQuadLayer`. */
  readonly capacity: number;
  /** Override the built-in `LINE_WGSL`. Must keep the `LineInstance` layout and the `viewport` /
   * `instances` binding names — this exists for custom colouring, not a different data model. */
  readonly shader?: string;
  readonly blend?: BlendPreset;
  readonly label?: string;
  readonly warnings?: WarningsLog;
}

/** `0xRRGGBBAA` from 0–255 components. `a` defaults to fully opaque. */
export function packRgba8(r: number, g: number, b: number, a = 255): number {
  return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
}

/**
 * Writes one line at `index` into a buffer sized `count * LINE_INSTANCE_STRIDE`. Exported
 * separately from `packLines()` so a consumer with an existing scratch buffer can fill it in place
 * every frame without allocating — the axis-rule case regenerates its lines on each viewport
 * change, and a per-frame allocation there is exactly the kind of churn PLAN.md §19.2 warns about.
 */
export function writeLine(view: DataView, index: number, line: LineInstance): void {
  const at = index * LINE_INSTANCE_STRIDE;
  view.setFloat32(at + 0, line.x0, true);
  view.setFloat32(at + 4, line.y0, true);
  view.setFloat32(at + 8, line.x1, true);
  view.setFloat32(at + 12, line.y1, true);
  view.setFloat32(at + 16, line.widthPx, true);
  view.setUint32(at + 20, line.color >>> 0, true);
  view.setUint32(at + 24, line.flags ?? 0, true);
  view.setUint32(at + 28, 0, true); // _pad
}

/** Allocates and fills a buffer for `lines`. Convenience for small, infrequently-rebuilt sets. */
export function packLines(
  lines: readonly LineInstance[],
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly count: number } {
  const bytes = new Uint8Array(new ArrayBuffer(lines.length * LINE_INSTANCE_STRIDE));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < lines.length; i++) writeLine(view, i, lines[i]!);
  return { bytes, count: lines.length };
}

/**
 * PLAN.md §12.1's second core rendering primitive: "instanced quads expanded to screen-space thick
 * lines in the vertex stage (axis rules, connectors, edges)."
 *
 * It *composes* `InstancedQuadLayer` rather than duplicating it — the primitive is genuinely a quad
 * layer plus the line-expansion math and an instance layout, so the only thing this class adds over
 * its base is the built-in shader, the packing helpers above, and a name that says what it draws.
 * Unlike `InstancedQuadLayer` (which takes the consumer's shader, because "what a quad means" is
 * component policy) a line is the same thing in every component, so the shader ships with the
 * layer and the override is the exception.
 */
export class LineLayer {
  private readonly base: InstancedQuadLayer;
  /** Unlike `InstancedQuadLayer`, this layer needs no fallback *policy* from its consumer: the
   * `LineInstance` layout is `core`'s own, so `core` can decode it. That is the difference between
   * a primitive whose bytes mean something fixed and one whose bytes mean whatever the component's
   * shader says. */
  private mirror: DataView | null = null;
  private count = 0;
  private readonly label: string | undefined;

  constructor(opts: LineLayerOptions) {
    this.base = new InstancedQuadLayer({
      gpu: opts.gpu,
      shader: opts.shader ?? LINE_WGSL,
      instanceStride: LINE_INSTANCE_STRIDE,
      capacity: opts.capacity,
      blend: opts.blend,
      label: opts.label,
      warnings: opts.warnings,
    });
    this.label = opts.label;
  }

  /** See `InstancedQuadLayer.instances` — the same escape hatch, for a compute pass that generates
   * or filters lines on the GPU (a future graph component's edge list, say). */
  get instances(): StorageBuffer {
    return this.base.instances;
  }

  bindViewport(uniforms: unknown): void {
    this.base.bindViewport(uniforms);
  }

  bind(values: Record<string, unknown>): void {
    this.base.bind(values);
  }

  /** Convenience over `upload()` for callers holding `LineInstance` objects rather than bytes. */
  uploadLines(lines: readonly LineInstance[]): void {
    const { bytes, count } = packLines(lines);
    this.upload(bytes, count);
  }

  upload(bytes: ArrayBufferView<ArrayBuffer>, count: number): void {
    this.base.upload(bytes, count);
    // Copied for the same aliasing reason `InstancedQuadLayer.upload()` copies: callers reuse
    // scratch buffers across uploads.
    const copy = new Uint8Array(count * LINE_INSTANCE_STRIDE);
    copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, count * LINE_INSTANCE_STRIDE));
    this.mirror = new DataView(copy.buffer);
    this.count = count;
  }

  draw(pass: PassEncoder): void {
    if (pass.kind === "canvas2d") {
      this.drawCanvas2D(pass);
      return;
    }
    this.base.draw(pass);
  }

  /**
   * PLAN.md §22.2's `LineLayer` row: "`stroke()` paths", capped at ~20k segments. Thickness is in
   * CSS pixels on both paths — `lineWidth` here, the pixel-space normal offset in the shader — so a
   * rule looks the same weight whichever backend drew it.
   */
  private drawCanvas2D(pass: Canvas2DPassEncoder): void {
    if (this.count === 0 || !this.mirror) return;

    const stride = samplingStride(this.count, CANVAS2D_CAPS.lineSegments);
    if (stride > 1) {
      pass.report(
        `${this.label ?? "LineLayer"}: ${this.count} segments exceeds the Canvas2D budget of ` +
          `${CANVAS2D_CAPS.lineSegments} — drawing every ${stride}th`,
      );
    }

    const { ctx, width, height, viewport } = pass;
    const [timeScale, timeOffset] = viewport.timeToClip;
    const [trackScale, trackOffset] = viewport.trackToClip;
    let lastColor = -1;
    let lastWidth = -1;

    for (let i = 0; i < this.count; i += stride) {
      const at = i * LINE_INSTANCE_STRIDE;
      const flags = this.mirror.getUint32(at + 24, true);
      const clipX = (flags & LINE_FLAG_CLIP_X) !== 0;
      const clipY = (flags & LINE_FLAG_CLIP_Y) !== 0;

      const toClipX = (v: number) => (clipX ? v : v * timeScale + timeOffset);
      const toClipY = (v: number) => (clipY ? v : v * trackScale + trackOffset);

      const x0 = clipToPixelX(toClipX(this.mirror.getFloat32(at + 0, true)), width);
      const y0 = clipToPixelY(toClipY(this.mirror.getFloat32(at + 4, true)), height);
      const x1 = clipToPixelX(toClipX(this.mirror.getFloat32(at + 8, true)), width);
      const y1 = clipToPixelY(toClipY(this.mirror.getFloat32(at + 12, true)), height);
      const lineWidth = Math.max(1, this.mirror.getFloat32(at + 16, true));
      const color = this.mirror.getUint32(at + 20, true);

      if (color !== lastColor) {
        ctx.strokeStyle = cssColor(color);
        lastColor = color;
      }
      if (lineWidth !== lastWidth) {
        ctx.lineWidth = lineWidth;
        lastWidth = lineWidth;
      }
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  drawIndirect(pass: PassEncoder, indirect: StorageBuffer): void {
    this.base.drawIndirect(pass, indirect);
  }

  dispose(): void {
    this.base.dispose();
  }
}
