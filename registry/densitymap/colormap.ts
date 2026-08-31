/**
 * Colormap LUTs via `core`'s `ResourceRegistry` — same ramps as `GPUHeatmap`, copied so this
 * component stays self-contained under the copy-the-source registry model.
 */

export type ColormapName = "viridis" | "magma" | "cividis";

export const LUT_SIZE = 256;

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

export function colormapKey(name: ColormapName): string {
  return `colormap:${name}:${LUT_SIZE}`;
}
