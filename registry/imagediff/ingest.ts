import type { ImageTextureSource } from "@gpu-components/core";

/**
 * `GPUImageDiff`'s data model — PLAN.md §6.2 candidate #10 (120.5), scoring 9 on GPU necessity.
 *
 * Chosen as the sixth component for one reason: it is the only candidate that forces **real
 * textures**. Every component so far reads storage buffers, and `RasterLayer` sidesteps textures
 * deliberately (see its doc comment). Nothing in the project called `sampler()` or created a
 * sampled texture until this one, and `caps.maxTextureDimension2D` was probed and never read.
 */

export interface ImagePair {
  readonly before: ImageTextureSource;
  readonly after: ImageTextureSource;
  readonly width: number;
  readonly height: number;
}

/** How two images are composited for comparison. Order matches the WGSL `mode` uniform. */
export const DIFF_MODES = ["split", "onion", "difference", "heat"] as const;
export type DiffMode = (typeof DIFF_MODES)[number];

export function modeIndex(mode: DiffMode): number {
  return DIFF_MODES.indexOf(mode);
}

/**
 * Pairs two images, requiring identical dimensions.
 *
 * Mismatched sizes are rejected rather than letter-boxed: a diff between differently-sized images
 * is a different feature (alignment), and silently scaling one would make every pixel "differ",
 * which is a worse answer than an error.
 */
export function ingestPair(before: ImageTextureSource, after: ImageTextureSource): ImagePair {
  if (before.width !== after.width || before.height !== after.height) {
    throw new RangeError(
      `gpu-components/imagediff: images must match — got ${before.width}x${before.height} and ` +
        `${after.width}x${after.height}`,
    );
  }
  return { before, after, width: before.width, height: before.height };
}

/** Allocates an RGBA8 buffer and fills it from a per-pixel function. For demos and tests. */
export function generateImage(
  width: number,
  height: number,
  shade: (x: number, y: number) => readonly [number, number, number, number],
): ImageTextureSource {
  const data = new Uint8Array(new ArrayBuffer(width * height * 4));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = shade(x, y);
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = a;
    }
  }
  return { data, width, height };
}
