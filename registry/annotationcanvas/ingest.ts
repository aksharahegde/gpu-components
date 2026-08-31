/**
 * `GPUAnnotationCanvas`'s field model — a dense Float32 grid in image space, uploaded once and
 * windowed/colour-mapped at draw time (mirrors `registry/heatmap`'s matrix ingest shape).
 */

export interface FieldData {
  readonly width: number;
  readonly height: number;
  /** Row-major, `width * height` values. NaN marks a missing sample (rendered transparent). */
  /** `<ArrayBuffer>` explicitly: these bytes go straight to GPU storage, whose `BufferSource`
   * parameter does not accept the default `ArrayBufferLike` widening. */
  readonly values: Float32Array<ArrayBuffer>;
  readonly window: { readonly min: number; readonly max: number };
}

/** Largest supported field dimension — aligned with device texture limits (v1 policy). */
export const MAX_FIELD_DIM = 8192;

/** Bytes per value in the GPU storage buffer — plain `f32`. */
export const VALUE_STRIDE = 4;

export interface IngestFieldInput {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array | readonly number[];
  readonly window?: { readonly min: number; readonly max: number };
}

/**
 * Validates and wraps a raw field. Non-finite values are kept (they have a position) but excluded
 * from the default window reduction so one NaN cannot blow out the display range.
 */
export function ingestField(input: IngestFieldInput): FieldData {
  const { width, height, values, window } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(
      `gpu-components/annotationcanvas: width and height must be positive integers, got ${width}x${height}`,
    );
  }
  const expected = width * height;
  if (values.length !== expected) {
    throw new RangeError(
      `gpu-components/annotationcanvas: expected ${expected} values for a ${width}x${height} field, got ${values.length}`,
    );
  }
  const typed: Float32Array<ArrayBuffer> =
    values instanceof Float32Array ? (values as Float32Array<ArrayBuffer>) : Float32Array.from(values);
  return {
    width,
    height,
    values: typed,
    window: window ?? computeWindow(typed),
  };
}

function computeWindow(values: Float32Array<ArrayBuffer>): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return { min: 0, max: 1 };
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}
