import type { Gpu } from "vgpu";
import type { Capabilities } from "./capabilities.ts";
import { GpuBudgetExceededError } from "./budget.ts";

/**
 * Image textures — the gap PLAN.md §9.2 assigns to nobody.
 *
 * That section's table is the project's contract for "what vgpu provides vs what we provide", and
 * it lists text, picking, device loss, scheduling, layout and accessibility as ours. **Textures
 * from images appear in neither column.** vgpu exports `sampler()` (cached by descriptor) and
 * creates textures for render *targets*, but there is no path from pixel data to a sampled texture
 * — every image-shaped component would otherwise reach for `gpu.gpu` and hand-roll it.
 *
 * This is also the first consumer of `caps.maxTextureDimension2D`, which has been probed since
 * Phase 1 and read by nothing — the same pattern the other three device limits had before they
 * were wired up.
 *
 * Deliberately thin: it creates, uploads and destroys. Mipmaps, compressed formats and array
 * layers are not here because nothing needs them yet, and §12.1's four-primitive rule exists to
 * stop exactly that kind of speculative growth.
 */

export interface ImageTextureSource {
  /** Tightly packed RGBA8, `width * height * 4` bytes. `<ArrayBuffer>` explicitly: this goes
   * straight to `queue.writeTexture`, whose source type rejects the default `ArrayBufferLike`. */
  readonly data: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

export interface ImageTexture {
  readonly texture: GPUTexture;
  /** Bind this, not the texture — a `texture_2d<f32>` binding takes a view. */
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
  destroy(): void;
}

export interface ImageTextureOptions {
  readonly label?: string;
  /** Defaults to `rgba8unorm`. `rgba8unorm-srgb` if the source is already gamma-encoded and the
   * shader should read linear values. */
  readonly format?: GPUTextureFormat;
}

/** Bytes per pixel for the formats this helper supports. */
const BYTES_PER_PIXEL = 4;

/**
 * `GPUTextureUsage` spelled out, because the global is not guaranteed to exist.
 *
 * It is a `GPUTextureUsage` namespace object installed by whoever provides WebGPU — the browser, or
 * `vgpu/node` when it initialises Dawn. A mock device provides neither, so referencing the global
 * throws `GPUTextureUsage is not defined` before the mock ever sees the call. These are the fixed
 * values from the WebGPU specification; unlike the global, they are always here.
 */
const TEXTURE_BINDING = 0x04;
const COPY_DST = 0x02;
const RENDER_ATTACHMENT = 0x10;

/**
 * Uploads pixel data to a sampled texture.
 *
 * Uses `writeTexture` rather than `copyExternalImageToTexture` on purpose: the latter needs an
 * `ImageBitmap`/canvas and therefore a browser, while raw bytes work identically under `vgpu/node`.
 * That is what lets an image component have real pixel tests instead of only browser ones — the
 * lesson this project learned three times over.
 */
export function createImageTexture(
  gpu: Gpu,
  source: ImageTextureSource,
  caps: Pick<Capabilities, "maxTextureDimension2D"> | null,
  options: ImageTextureOptions = {},
): ImageTexture {
  const { width, height } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`gpu-components: image dimensions must be positive integers, got ${width}x${height}`);
  }
  const expected = width * height * BYTES_PER_PIXEL;
  if (source.data.length !== expected) {
    throw new RangeError(
      `gpu-components: expected ${expected} bytes for a ${width}x${height} RGBA image, got ${source.data.length}`,
    );
  }

  // The limit that has been probed since Phase 1 and never read. Exceeding it is a typed error
  // with the actual numbers, not a driver rejection (§14.3's rule, applied to textures).
  const limit = caps?.maxTextureDimension2D ?? 0;
  if (limit > 0 && (width > limit || height > limit)) {
    throw new GpuBudgetExceededError(
      `${options.label ?? "image"} (${width}x${height})`,
      Math.max(width, height),
      limit,
    );
  }

  const device = gpu.gpu;
  const texture = device.createTexture({
    label: options.label,
    size: [width, height, 1],
    format: options.format ?? "rgba8unorm",
    usage: TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT,
  });

  device.queue.writeTexture(
    { texture },
    source.data,
    { bytesPerRow: width * BYTES_PER_PIXEL, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );

  return {
    texture,
    view: texture.createView(),
    width,
    height,
    destroy() {
      // Unlike vgpu's storage buffers, `GPUTexture` does expose `destroy()` — and an image texture
      // is large enough that waiting for `gpu.dispose()` would be a real leak between datasets.
      texture.destroy();
    },
  };
}
