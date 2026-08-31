/**
 * Full-screen field pass for `GPUAnnotationCanvas`.
 *
 * The Float32 image remains a row-major storage buffer. Windowing and LUT lookup happen at draw
 * time, so changing either display control does not rebuild or re-upload the field.
 */
export const FIELD_LUT_SIZE = 256;

export const FIELD_WGSL = /* wgsl */ `
struct Viewport {
  timeToClip: vec2f,
  trackToClip: vec2f,
  pxSize: vec2f,
}

struct FieldParams {
  width: u32,
  height: u32,
  windowMin: f32,
  windowMax: f32,
}

@group(0) @binding(0) var<uniform> viewport: Viewport;
@group(0) @binding(1) var<uniform> params: FieldParams;
@group(0) @binding(2) var<storage, read> values: array<f32>;
@group(0) @binding(3) var<storage, read> lut: array<vec4f>;

const LUT_MAX: f32 = ${FIELD_LUT_SIZE - 1}.0;

fn sampleLut(t: f32) -> vec4f {
  let position = clamp(t, 0.0, 1.0) * LUT_MAX;
  let lo = u32(floor(position));
  let hi = min(lo + 1u, u32(LUT_MAX));
  return mix(lut[lo], lut[hi], position - f32(lo));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let clip = vec2f(2.0 * uv.x - 1.0, 1.0 - 2.0 * uv.y);
  let image = vec2f(
    (clip.x - viewport.timeToClip.y) / viewport.timeToClip.x,
    (clip.y - viewport.trackToClip.y) / viewport.trackToClip.x,
  );
  let col = i32(floor(image.x));
  let row = i32(floor(image.y));

  if (col < 0 || row < 0 || u32(col) >= params.width || u32(row) >= params.height) {
    discard;
  }

  let value = values[u32(row) * params.width + u32(col)];
  if (value != value) {
    discard;
  }

  let span = max(params.windowMax - params.windowMin, 1e-20);
  return sampleLut((value - params.windowMin) / span);
}
`;
