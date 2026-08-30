/**
 * Colormap LUTs, resolved through `core`'s `ResourceRegistry` (PLAN.md §14.1a lists "colormaps"
 * as its first named use case).
 *
 * Worth recording for the Phase 5 architecture test: **this is `ResourceRegistry`'s first
 * production consumer.** It shipped in Phase 1 and `registry/timeline` never calls `acquire()` —
 * a heatmap is the component that actually needs a shared, content-keyed, ref-counted resource,
 * because two heatmaps on a page with the same ramp should hold one LUT between them.
 */

export type ColormapName = "viridis" | "magma" | "cividis";

/** Number of entries in a generated LUT. 256 is the standard ramp resolution and keeps the buffer
 * at 4KB — small enough that sharing it matters less for memory than for cache identity. */
export const LUT_SIZE = 256;

/** Control points, sampled from the standard perceptually-uniform ramps at 5 stops and interpolated
 * in linear space. Not the full 256-entry published tables — 5 stops reproduces these ramps closely
 * enough for a data surface, and keeps this file readable, which matters for code the user owns. */
const RAMPS: Record<ColormapName, readonly (readonly [number, number, number])[]> = {
  viridis: [
    [0.267, 0.005, 0.329],
    [0.229, 0.322, 0.545],
    [0.128, 0.567, 0.551],
    [0.369, 0.789, 0.383],
    [0.993, 0.906, 0.144],
  ],
  magma: [
    [0.001, 0.000, 0.014],
    [0.232, 0.059, 0.437],
    [0.550, 0.161, 0.506],
    [0.868, 0.288, 0.409],
    [0.987, 0.991, 0.749],
  ],
  cividis: [
    [0.000, 0.135, 0.305],
    [0.263, 0.306, 0.428],
    [0.480, 0.481, 0.471],
    [0.715, 0.669, 0.417],
    [0.996, 0.909, 0.216],
  ],
};

/**
 * Builds a `LUT_SIZE`-entry RGBA ramp as `vec4<f32>` data, ready for a storage buffer.
 *
 * `vec4f` rather than packed RGBA8 because the shader interpolates *and* the values are already
 * linear — packing to 8-bit here would quantise the ramp before the fragment shader ever samples
 * it, which is exactly the "colormap interpolation in sRGB is visibly wrong" failure PLAN.md §31
 * open question #11 warns about.
 */
export function buildColormapLut(name: ColormapName): Float32Array<ArrayBuffer> {
  const stops = RAMPS[name];
  const lut = new Float32Array(new ArrayBuffer(LUT_SIZE * 4 * 4));
  const segments = stops.length - 1;

  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / (LUT_SIZE - 1)) * segments;
    const segment = Math.min(Math.floor(t), segments - 1);
    const local = t - segment;
    const a = stops[segment]!;
    const b = stops[segment + 1]!;
    lut[i * 4 + 0] = a[0] + (b[0] - a[0]) * local;
    lut[i * 4 + 1] = a[1] + (b[1] - a[1]) * local;
    lut[i * 4 + 2] = a[2] + (b[2] - a[2]) * local;
    lut[i * 4 + 3] = 1;
  }
  return lut;
}

/** Content-derived registry key, so two components asking for the same ramp dedupe (§14.1a). */
export function colormapKey(name: ColormapName): string {
  return `colormap:${name}:${LUT_SIZE}`;
}
