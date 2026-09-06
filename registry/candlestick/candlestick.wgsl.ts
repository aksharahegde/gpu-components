/**
 * `GPUCandlestick`'s shaders.
 *
 * The ring addressing here is copied in spirit, not in code, from `GPULogViewer` — `slot = (head +
 * logical) % capacity` is `RingBuffer`'s published contract and every consumer implements it in its
 * own shader. That duplication is deliberate and worth naming: the alternative is a WGSL include
 * mechanism WGSL does not have, and the cost is bounded by the pixel tests, which wrap a real ring
 * and check the GPU agrees with `RingBuffer.slotOf`.
 *
 * Bars are positioned by **ordinal**, not by timestamp. Every trading chart does this so that
 * weekends and halts do not open gaps, and it has a second benefit here: the x domain is a small
 * integer range, so it never runs into the f32 precision problems an absolute epoch would.
 */

export const OVERVIEW_BUCKETS = 96;
export const OVERVIEW_WORKGROUP_SIZE = 64;

const COMMON = /* wgsl */ `
struct Bar {
  time: f32,
  open: f32,
  high: f32,
  low: f32,
  close: f32,
  volume: f32,
}

struct Params {
  head: u32,
  count: u32,
  capacity: u32,
  firstVisible: u32,
  visibleCount: u32,
  // Price range of the visible window, computed on the CPU — see ingest.ts for why 300 numbers do
  // not deserve a compute pass.
  priceMin: f32,
  priceMax: f32,
  surfaceW: f32,
  // Full target height, used for the clip transform.
  surfaceH: f32,
  // Height of the candle area alone: the target minus the overview strip. Prices map into this,
  // while positions still map to clip through surfaceH — conflating the two stretched the chart
  // over the whole target and drew it behind the strip.
  chartH: f32,
  // Bar pitch and body width in pixels; the gap between them is the spacing.
  pitchPx: f32,
  bodyPx: f32,
  // Sub-bar horizontal scroll, so panning is smooth rather than snapping bar to bar.
  scrollPx: f32,
  hovered: i32,
  _pad0: u32,
  _pad1: u32,
}

fn slotOf(p: Params, logical: u32) -> u32 {
  return (p.head + logical) % p.capacity;
}

/** Price to pixels within the candle area, y down. */
fn priceToPx(p: Params, price: f32) -> f32 {
  let span = max(p.priceMax - p.priceMin, 1e-9);
  return (1.0 - (price - p.priceMin) / span) * p.chartH;
}

fn pxToClip(p: Params, px: vec2f) -> vec4f {
  return vec4f((px.x / p.surfaceW) * 2.0 - 1.0, 1.0 - (px.y / p.surfaceH) * 2.0, 0.0, 1.0);
}

const UP_COLOR = vec3f(0.055, 0.486, 0.345);
const DOWN_COLOR = vec3f(0.753, 0.169, 0.169);
`;

/**
 * Bodies and wicks in **one** instanced draw.
 *
 * Two instances per bar rather than two draw calls: instance `2i` is the body, `2i+1` is the wick.
 * The alternative — a `LineLayer` for wicks and an `InstancedQuadLayer` for bodies — would be two
 * pipelines and two buffers to keep in step for a shape that is always drawn together. The wick is a
 * one-pixel-wide quad, which is exactly what `LineLayer` would produce for a vertical segment
 * anyway, so nothing is gained by routing it through the general primitive.
 */
export const CANDLE_WGSL = /* wgsl */ `
${COMMON}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> bars: array<Bar>;

struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) rising: u32,
  @location(1) @interpolate(flat) hovered: u32,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instance: u32) -> VsOut {
  let barSlot = instance / 2u;
  let isWick = (instance & 1u) == 1u;
  let logical = params.firstVisible + barSlot;

  var out: VsOut;
  if (barSlot >= params.visibleCount || logical >= params.count) {
    out.position = vec4f(0.0, 0.0, 0.0, 0.0);
    return out;
  }

  let bar = bars[slotOf(params, logical)];
  let corner = vec2f(
    f32((vertexIndex == 1u) || (vertexIndex == 2u) || (vertexIndex == 4u)),
    f32((vertexIndex == 2u) || (vertexIndex == 4u) || (vertexIndex == 5u)),
  );

  let centerX = (f32(barSlot) + 0.5) * params.pitchPx - params.scrollPx;
  let width = select(params.bodyPx, max(1.0, params.pitchPx * 0.08), isWick);

  var topPrice = max(bar.open, bar.close);
  var bottomPrice = min(bar.open, bar.close);
  if (isWick) {
    topPrice = bar.high;
    bottomPrice = bar.low;
  }

  var topPx = priceToPx(params, topPrice);
  var bottomPx = priceToPx(params, bottomPrice);
  // A doji — open equal to close — would collapse the body to zero height and vanish. Every chart
  // draws it as a horizontal line, so give it a minimum of one pixel.
  if (!isWick && bottomPx - topPx < 1.0) {
    let mid = (topPx + bottomPx) * 0.5;
    topPx = mid - 0.5;
    bottomPx = mid + 0.5;
  }

  let px = vec2f(
    centerX - width * 0.5 + corner.x * width,
    topPx + corner.y * (bottomPx - topPx),
  );

  out.position = pxToClip(params, px);
  out.rising = select(0u, 1u, bar.close >= bar.open);
  out.hovered = select(0u, 1u, params.hovered >= 0 && u32(params.hovered) == logical);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  var color = select(DOWN_COLOR, UP_COLOR, in.rising == 1u);
  if (in.hovered == 1u) {
    color = mix(color, vec3f(0.051, 0.059, 0.078), 0.35);
  }
  return vec4f(color, 1.0);
}
`;

/**
 * The overview reduction — over **every** bar, not the visible ones.
 *
 * This is the component's one unambiguous §5 gate-2 claim. "What did the whole history do, and where
 * am I in it" is a question about all N bars, and answering it on the CPU means walking the entire
 * series on the main thread every time it grows. Here it is one dispatch into 96 buckets.
 *
 * **The bit-pattern trick, and its limit.** WGSL atomics are integer-only, so the min/max envelope
 * compares `bitcast<u32>` of the price. The IEEE-754 bit pattern of a *positive* float is monotonic
 * when read as an unsigned integer, which makes this exact rather than approximate — but the sign
 * bit inverts the ordering, so a negative price would compare as larger than every positive one.
 * `validateBars` rejects those at ingest rather than letting the envelope come out silently wrong.
 */
export const OVERVIEW_WGSL = /* wgsl */ `
${COMMON}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> bars: array<Bar>;
// Per bucket: [minPriceBits, maxPriceBits, volume]. minPriceBits starts at 0xffffffff.
@group(0) @binding(2) var<storage, read_write> buckets: array<atomic<u32>>;

@compute @workgroup_size(${OVERVIEW_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let logical = gid.x;
  if (logical >= params.count) {
    return;
  }
  let bar = bars[slotOf(params, logical)];

  // Bucket by logical position so the strip reads oldest-to-newest and does not reshuffle when the
  // ring wraps.
  let bucket = min(
    (logical * ${OVERVIEW_BUCKETS}u) / max(params.count, 1u),
    ${OVERVIEW_BUCKETS}u - 1u,
  );
  let base = bucket * 3u;

  atomicMin(&buckets[base], bitcast<u32>(bar.low));
  atomicMax(&buckets[base + 1u], bitcast<u32>(bar.high));
  // Volume is summed as a whole number of units; the demo's volumes are integers and a f32 sum in
  // an atomic is not available anyway.
  atomicAdd(&buckets[base + 2u], u32(bar.volume));
}
`;

/** Draws the reduced envelope as a strip along the bottom, with the visible window marked. */
export const OVERVIEW_DRAW_WGSL = /* wgsl */ `
struct OverviewParams {
  bucketCount: u32,
  // Envelope extremes across the whole history, from the 96 buckets read back once per data change.
  lowest: f32,
  highest: f32,
  peakVolume: f32,
  surfaceW: f32,
  surfaceH: f32,
  heightPx: f32,
  windowStart: f32,
  windowEnd: f32,
  // 0 until readOverview() has normalised the extremes. Until then the envelope has no scale to be
  // drawn against and must not be drawn at all — see the note on the vertex shader.
  ready: u32,
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> ov: OverviewParams;
@group(0) @binding(1) var<storage, read> buckets: array<u32>;

struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) inWindow: u32,
  @location(1) @interpolate(flat) kind: u32,  // 0 envelope, 1 volume
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instance: u32) -> VsOut {
  // Two instances per bucket: the price envelope and, beneath it, the volume bar.
  let bucket = instance / 2u;
  let isVolume = (instance & 1u) == 1u;

  let corner = vec2f(
    f32((vertexIndex == 1u) || (vertexIndex == 2u) || (vertexIndex == 4u)),
    f32((vertexIndex == 2u) || (vertexIndex == 4u) || (vertexIndex == 5u)),
  );

  let stripTop = ov.surfaceH - ov.heightPx;
  let colW = ov.surfaceW / f32(ov.bucketCount);
  let xPx = (f32(bucket) + corner.x) * colW;

  let lowBits = buckets[bucket * 3u];
  let highBits = buckets[bucket * 3u + 1u];
  let low = bitcast<f32>(lowBits);
  let high = bitcast<f32>(highBits);
  let volume = f32(buckets[bucket * 3u + 2u]);

  var out: VsOut;

  // Nothing to draw yet, or nothing in this bucket.
  //
  // Both cases used to produce a quad thousands of pixels tall that painted over the entire chart,
  // and the pixel tests caught it. Before readOverview runs, the extremes are still their
  // placeholder 0 and 1 while the buckets hold real prices, so the normalised height came out around
  // -99 screens. An empty bucket is worse: its atomicMin sentinel is 0xffffffff, which reads back as
  // NaN and takes the whole quad with it.
  let emptyBucket = lowBits == 0xffffffffu || highBits == 0u;
  if (ov.ready == 0u || (emptyBucket && !isVolume)) {
    out.position = vec4f(0.0, 0.0, 0.0, 0.0);
    return out;
  }

  var topPx: f32;
  var bottomPx: f32;
  if (isVolume) {
    let volumeArea = ov.heightPx * 0.3;
    let h = (volume / max(ov.peakVolume, 1.0)) * volumeArea;
    bottomPx = ov.surfaceH;
    topPx = ov.surfaceH - max(h, 1.0);
  } else {
    let span = max(ov.highest - ov.lowest, 1e-9);
    let envelopeArea = ov.heightPx * 0.7;
    topPx = stripTop + (1.0 - (high - ov.lowest) / span) * envelopeArea;
    bottomPx = stripTop + (1.0 - (low - ov.lowest) / span) * envelopeArea;
    if (bottomPx - topPx < 1.0) { bottomPx = topPx + 1.0; }
  }

  // Belt and braces: whatever the arithmetic produced, the strip stays inside its own band. The
  // chart above it is not this shader's to paint.
  topPx = clamp(topPx, stripTop, ov.surfaceH);
  bottomPx = clamp(bottomPx, stripTop, ov.surfaceH);

  out.position = vec4f(
    (xPx / ov.surfaceW) * 2.0 - 1.0,
    1.0 - ((topPx + corner.y * (bottomPx - topPx)) / ov.surfaceH) * 2.0,
    0.0,
    1.0,
  );
  let position = f32(bucket) / f32(ov.bucketCount);
  out.inWindow = select(0u, 1u, position >= ov.windowStart && position <= ov.windowEnd);
  out.kind = select(0u, 1u, isVolume);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  var color = select(vec3f(0.847, 0.863, 0.898), vec3f(0.741, 0.765, 0.816), in.kind == 1u);
  if (in.inWindow == 1u) {
    color = mix(color, vec3f(0.239, 0.310, 0.839), 0.55);
  }
  return vec4f(color, 1.0);
}
`;
