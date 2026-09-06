/**
 * `GPULogViewer`'s shaders.
 *
 * Two things worth knowing before reading them.
 *
 * **Positions are computed in pixels, not through `viewportUniforms`.** Every other component maps a
 * domain to clip space through the shared viewport uniform, and that is right when the domain is
 * continuous. Here the GPU rows must land on exactly the same pixels as the Canvas2D text drawn over
 * them, and the text layer positions glyphs with `line * lineHeight - scroll`. Deriving clip space
 * from that same pixel arithmetic makes the alignment exact by construction; routing it through a
 * domain transform would make it exact only if two independently-rounded computations agreed, which
 * is the kind of thing that is off by one on some zoom levels and fine on the rest.
 *
 * **The ring is addressed, never reordered.** `slot = (head + logical) % capacity` is the whole
 * mechanism, and it is why appending a line costs one write of one record instead of a rewrite of a
 * million. `core/ringBuffer.ts` documents the invariant; both shaders below and `RingBuffer.slotOf`
 * implement it identically, and `render.pixels.test.ts` checks that they agree.
 */

/** Bucket count for the minimap reduction. 128 columns of a scrollbar-width strip. */
export const MINIMAP_BUCKETS = 128;
export const MINIMAP_WORKGROUP_SIZE = 64;

/**
 * Shared declarations. WGSL has no include mechanism, so this is concatenated into both shaders —
 * the alternative is two copies of a struct that must not drift, which is worse.
 */
const COMMON = /* wgsl */ `
struct LogRecord {
  // Seconds relative to the session epoch — see packLogRecords for why this is not absolute ms.
  time: f32,
  level: u32,
}

struct Params {
  // Ring addressing.
  head: u32,
  count: u32,
  capacity: u32,
  // Logical index of the topmost visible line.
  firstVisible: u32,
  // Sub-line scroll offset in pixels, so scrolling is smooth rather than line-snapped.
  scrollPx: f32,
  lineHeightPx: f32,
  surfaceW: f32,
  surfaceH: f32,
  stripeWidthPx: f32,
  // Logical index of the selected line, or -1.
  selected: i32,
  // Whether a query is active: with no query nothing is "unmatched", so nothing should be dimmed.
  filtering: u32,
  _pad: u32,
}

fn slotOf(p: Params, logical: u32) -> u32 {
  return (p.head + logical) % p.capacity;
}
`;

/** Level colours, shared by the row shader and the minimap so a level means one colour everywhere. */
const LEVEL_COLORS = /* wgsl */ `
fn levelColor(level: u32) -> vec3f {
  switch level {
    case 0u: { return vec3f(0.478, 0.510, 0.573); }  // trace
    case 1u: { return vec3f(0.322, 0.376, 0.478); }  // debug
    case 2u: { return vec3f(0.114, 0.373, 0.694); }  // info
    case 3u: { return vec3f(0.639, 0.404, 0.024); }  // warn
    default: { return vec3f(0.753, 0.169, 0.169); }  // error
  }
}
`;

/**
 * Row backgrounds and level stripes: one instance per **visible** line.
 *
 * The instance count is the window height in lines — about 60 — not the buffer size. That is the
 * point of virtualising over a ring: a million-line buffer and a sixty-line window cost the same to
 * draw, and scrolling changes one uniform rather than touching any data.
 */
export const LOG_ROWS_WGSL = /* wgsl */ `
${COMMON}
${LEVEL_COLORS}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> lines: array<LogRecord>;
// One flag per slot, rewritten when the query changes — a user action, not a frame event.
@group(0) @binding(2) var<storage, read> matches: array<u32>;

struct VsOut {
  @builtin(position) position: vec4f,
  // 0..1 across the row, used to place the level stripe without a second draw.
  @location(0) rowUv: vec2f,
  @location(1) @interpolate(flat) level: u32,
  @location(2) @interpolate(flat) state: u32,  // bit 0 matched, bit 1 selected, bit 2 odd row
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instance: u32) -> VsOut {
  let logical = params.firstVisible + instance;

  var out: VsOut;
  if (logical >= params.count) {
    // Past the end of the data: collapse the quad to nothing rather than clipping a stretched one.
    out.position = vec4f(0.0, 0.0, 0.0, 0.0);
    return out;
  }

  // Two triangles from the vertex index — vgpu's no-geometry path, no vertex buffers anywhere.
  let corner = vec2f(
    f32((vertexIndex == 1u) || (vertexIndex == 2u) || (vertexIndex == 4u)),
    f32((vertexIndex == 2u) || (vertexIndex == 4u) || (vertexIndex == 5u)),
  );

  // Pixel space first, then clip — see this file's header for why this is not a domain transform.
  let topPx = f32(instance) * params.lineHeightPx - params.scrollPx;
  let yPx = topPx + corner.y * params.lineHeightPx;
  let xPx = corner.x * params.surfaceW;

  out.position = vec4f(
    (xPx / params.surfaceW) * 2.0 - 1.0,
    1.0 - (yPx / params.surfaceH) * 2.0,
    0.0,
    1.0,
  );
  out.rowUv = corner;

  let record = lines[slotOf(params, logical)];
  out.level = record.level;

  var state = 0u;
  if (matches[slotOf(params, logical)] != 0u) { state |= 1u; }
  if (params.selected >= 0 && u32(params.selected) == logical) { state |= 2u; }
  if ((logical & 1u) == 1u) { state |= 4u; }
  out.state = state;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let matched = (in.state & 1u) != 0u;
  let selected = (in.state & 2u) != 0u;
  let odd = (in.state & 4u) != 0u;

  // The level stripe down the left edge: same instance, no second draw call.
  if (in.rowUv.x * params.surfaceW < params.stripeWidthPx) {
    let dim = select(1.0, 0.25, params.filtering != 0u && !matched);
    return vec4f(levelColor(in.level) * dim, 1.0);
  }

  var background = select(vec3f(1.000, 1.000, 1.000), vec3f(0.957, 0.961, 0.969), odd);
  if (params.filtering != 0u && matched) {
    // Matched rows lift toward the level's hue rather than a fixed highlight colour, so severity
    // stays readable while filtering.
    background = mix(background, levelColor(in.level), 0.16);
  }
  if (selected) {
    background = mix(background, vec3f(0.780, 0.827, 0.949), 0.75);
  }
  return vec4f(background, 1.0);
}
`;

/**
 * The minimap reduction — compute in the data path, over the **whole** buffer.
 *
 * This is the component's clearest §5 gate-2 claim, and the reason it is more than a scrolling text
 * box. "Where are the errors in these million lines, and where are my matches" is a question about
 * every record, not the visible ones, and answering it on the CPU means walking a million entries on
 * the main thread. Here it is one dispatch into 128 atomic buckets.
 *
 * Two counters per bucket — matches and errors — so the strip can show both without a second pass.
 */
export const MINIMAP_WGSL = /* wgsl */ `
${COMMON}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> lines: array<LogRecord>;
@group(0) @binding(2) var<storage, read> matches: array<u32>;
// [bucket0.matched, bucket0.errors, bucket1.matched, ...] — integer because WGSL atomics are.
@group(0) @binding(3) var<storage, read_write> buckets: array<atomic<u32>>;

@compute @workgroup_size(${MINIMAP_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let logical = gid.x;
  if (logical >= params.count) {
    return;
  }
  let slot = slotOf(params, logical);

  // Bucket by *logical* position, so the strip reads oldest-at-top like the lines themselves and
  // does not shuffle every time the ring wraps.
  let bucket = min(
    (logical * ${MINIMAP_BUCKETS}u) / max(params.count, 1u),
    ${MINIMAP_BUCKETS}u - 1u,
  );

  if (matches[slot] != 0u) {
    atomicAdd(&buckets[bucket * 2u], 1u);
  }
  if (lines[slot].level >= 4u) {
    atomicAdd(&buckets[bucket * 2u + 1u], 1u);
  }
}
`;

/** Draws the reduced buckets as a vertical strip: one instance per bucket. */
export const MINIMAP_DRAW_WGSL = /* wgsl */ `
${COMMON}

struct MinimapParams {
  bucketCount: u32,
  // Peak bucket totals, for normalisation — computed on the CPU from the 128 read-back values,
  // which is 128 numbers once per query, not a per-frame readback of the data itself.
  peakMatched: u32,
  peakErrors: u32,
  widthPx: f32,
  surfaceW: f32,
  surfaceH: f32,
  // Visible window as a fraction of the buffer, drawn as a thumb over the strip.
  windowStart: f32,
  windowEnd: f32,
}

@group(0) @binding(0) var<uniform> mm: MinimapParams;
@group(0) @binding(1) var<storage, read> buckets: array<u32>;

struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) cellUv: vec2f,
  @location(1) @interpolate(flat) matched: u32,
  @location(2) @interpolate(flat) errors: u32,
  @location(3) @interpolate(flat) inWindow: u32,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instance: u32) -> VsOut {
  let corner = vec2f(
    f32((vertexIndex == 1u) || (vertexIndex == 2u) || (vertexIndex == 4u)),
    f32((vertexIndex == 2u) || (vertexIndex == 4u) || (vertexIndex == 5u)),
  );

  let bandH = mm.surfaceH / f32(mm.bucketCount);
  let yPx = (f32(instance) + corner.y) * bandH;
  let xPx = mm.surfaceW - mm.widthPx + corner.x * mm.widthPx;

  var out: VsOut;
  out.position = vec4f(
    (xPx / mm.surfaceW) * 2.0 - 1.0,
    1.0 - (yPx / mm.surfaceH) * 2.0,
    0.0,
    1.0,
  );
  out.cellUv = corner;
  out.matched = buckets[instance * 2u];
  out.errors = buckets[instance * 2u + 1u];

  let position = f32(instance) / f32(mm.bucketCount);
  out.inWindow = select(0u, 1u, position >= mm.windowStart && position <= mm.windowEnd);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  var color = vec3f(0.925, 0.933, 0.945);

  let errorLoad = f32(in.errors) / f32(max(mm.peakErrors, 1u));
  if (in.errors > 0u) {
    color = mix(color, vec3f(0.753, 0.169, 0.169), clamp(errorLoad, 0.25, 1.0));
  }
  let matchLoad = f32(in.matched) / f32(max(mm.peakMatched, 1u));
  if (in.matched > 0u) {
    // Matches draw on the left half of the strip so a bucket can show both at once rather than one
    // hiding the other.
    if (in.cellUv.x < 0.5) {
      color = mix(color, vec3f(0.055, 0.486, 0.345), clamp(matchLoad, 0.3, 1.0));
    }
  }

  if (in.inWindow == 1u) {
    color = mix(color, vec3f(0.051, 0.059, 0.078), 0.22);
  }
  return vec4f(color, 1.0);
}
`;
