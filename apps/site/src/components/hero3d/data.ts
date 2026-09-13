import { mulberry32 } from '../demos/chrome'
import { HERO3D_INSTANCE_STRIDE } from './shader'
import { frustumHalfExtentsAt } from './cameraSpec'

/**
 * Seeded scene data for the static "Stacked Surfaces" hero (Phase 1+2 — see the plan in the task
 * that produced this file). Five depth layers, back to front, each themed as one of this product's
 * own visual languages (`Showcase.tsx`'s data-shape conventions, not its code — a decorative hero
 * has no reason to pull in the full registry ingest pipeline for a `RawSpan[]` it never hit-tests):
 *
 * 1. a faint backdrop panel (grounds the depth stack in the "one shared runtime" the copy claims)
 * 2. a heatmap cell lattice
 * 3. wide grid row bands
 * 4. timeline spans
 * 5. scatter points (frontmost)
 *
 * Deterministic and literal: one fixed seed, so every visitor and every build sees the identical
 * frame (same principle as `HeroMiniatures`' hand-drawn sketches and `Showcase`'s seeded demos).
 * Back-to-front order is baked into the array's write order once, here — `Hero3DComponent` never
 * sorts per frame (PLAN says the depth arrangement is static for this phase).
 *
 * Every layer's coordinates are authored as a *fraction* of `frustumHalfExtentsAt(depth)` — the
 * camera's actual view frustum size at that layer's depth (`cameraSpec.ts`) — rather than as
 * absolute numbers. A fixed coordinate range with no relationship to depth is what produced this
 * scene's first, badly broken render: every layer was sized for the frustum near the camera, so
 * anything placed farther back (most of the stack) rendered as a tiny, muddy cluster near the
 * center of a mostly-empty canvas.
 */

const SEED = 0x4845524f // "HERO" — arbitrary, fixed.

/** One quad instance: an in-plane translate (`tx`,`ty`) + depth (`tz`), a non-uniform in-plane
 * scale (`sx`,`sy`), and straight-alpha RGBA — see `shader.ts`'s `Instance` struct. */
interface HeroInstance {
  readonly tx: number
  readonly ty: number
  readonly tz: number
  readonly sx: number
  readonly sy: number
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Literal copies of `tokens.stylex.ts`'s ocean-blue palette — NOT an import of `color` from there.
 * `stylex.defineVars()` only produces real values through the StyleX babel/webpack compiler; the
 * object it hands a plain (non-JSX) module like this one at runtime holds opaque `"var(--x1a2b)"`
 * CSS-custom-property strings, not hex colors. `hexToRgb("var(--x1a2b)")` still "succeeds" (its
 * `parseInt` just stops at the first non-hex character), which is exactly how this scene first
 * shipped rendering every instance as near-black/gray instead of the intended blue/mint/amber —
 * silently wrong, not a crash. If `tokens.stylex.ts`'s values change, these must be updated by
 * hand; there is no compiler that can keep a `Float32Array` in sync with a CSS variable.
 */
const ACCENT = hexToRgb('#0077b6')
const ACCENT_HOVER = hexToRgb('#023e8a')
const ACCENT_DIM = hexToRgb('#90e0ef')
const MINT = hexToRgb('#0e7c58')
const AMBER = hexToRgb('#92590a')
const TEXT = hexToRgb('#03045e')

/** Depth (world Z) of each layer, back to front — camera sits at `+Z` looking toward `-Z`
 * (`cameraSpec.ts`), so more negative is farther away. Spaced so each layer's frustum is
 * meaningfully bigger than its neighbor's (the perspective "shrinking with distance" the spike's
 * screenshot showed), without crowding the near or far clip planes. */
const DEPTH = {
  backdrop: -9,
  heatmap: -6.6,
  gridRows: -4.8,
  timeline: -3,
  scatter: -1.2,
} as const

function rgba(rgb: readonly [number, number, number], a: number) {
  return { r: rgb[0], g: rgb[1], b: rgb[2], a }
}

function backdropLayer(): HeroInstance[] {
  // A single, near-full-frustum, very faint panel — grounds the stack without competing with the
  // real data layers in front of it.
  const { halfW, halfH } = frustumHalfExtentsAt(DEPTH.backdrop)
  return [
    { tx: 0, ty: 0, tz: DEPTH.backdrop, sx: halfW * 0.94, sy: halfH * 0.94, ...rgba(ACCENT_DIM, 0.07) },
  ]
}

const HEAT_ROWS = 9
const HEAT_COLS = 14

function heatmapLayer(rnd: () => number): HeroInstance[] {
  const { halfW, halfH } = frustumHalfExtentsAt(DEPTH.heatmap)
  const w = halfW * 0.62
  const h = halfH * 0.62
  const instances: HeroInstance[] = []
  const cellW = (2 * w) / HEAT_COLS
  const cellH = (2 * h) / HEAT_ROWS
  for (let r = 0; r < HEAT_ROWS; r++) {
    for (let c = 0; c < HEAT_COLS; c++) {
      const u = r / (HEAT_ROWS - 1)
      const v = c / (HEAT_COLS - 1)
      const d1 = Math.hypot(u - 0.3, v - 0.25)
      const d2 = Math.hypot(u - 0.7, v - 0.72)
      const value = 0.12 + Math.exp(-d1 * d1 * 30) + 0.6 * Math.exp(-d2 * d2 * 22) + rnd() * 0.03
      instances.push({
        tx: -w + cellW * (c + 0.5),
        ty: -h + cellH * (r + 0.5),
        tz: DEPTH.heatmap,
        sx: (cellW / 2) * 0.86,
        sy: (cellH / 2) * 0.86,
        ...rgba(ACCENT, Math.min(0.6, 0.16 + value * 0.4)),
      })
    }
  }
  return instances
}

const GRID_ROW_COUNT = 6

function gridRowsLayer(): HeroInstance[] {
  const { halfW, halfH } = frustumHalfExtentsAt(DEPTH.gridRows)
  const w = halfW * 0.6
  const h = halfH * 0.55
  const instances: HeroInstance[] = []
  for (let i = 0; i < GRID_ROW_COUNT; i++) {
    const ty = -h + (2 * h * i) / (GRID_ROW_COUNT - 1)
    const rowColor = i % 2 === 0 ? TEXT : ACCENT_HOVER
    instances.push({ tx: 0, ty, tz: DEPTH.gridRows, sx: w, sy: (h / GRID_ROW_COUNT) * 0.6, ...rgba(rowColor, 0.16) })
  }
  return instances
}

const SPAN_COUNT = 54
const SPAN_TRACKS = 4
const SPAN_COLORS = [ACCENT, MINT, AMBER] as const

function timelineLayer(rnd: () => number): HeroInstance[] {
  const { halfW, halfH } = frustumHalfExtentsAt(DEPTH.timeline)
  const w = halfW * 0.6
  const h = halfH * 0.32
  const instances: HeroInstance[] = []
  for (let i = 0; i < SPAN_COUNT; i++) {
    const burst = Math.floor(rnd() * 8)
    const start = -w + (burst / 8) * 2 * w + rnd() * (w / 4)
    const duration = (0.06 + rnd() * rnd() * 0.32) * (w / 1.4)
    const track = Math.floor(rnd() * SPAN_TRACKS)
    instances.push({
      tx: start + duration / 2,
      ty: -h + (track / (SPAN_TRACKS - 1)) * 2 * h,
      tz: DEPTH.timeline,
      sx: duration / 2,
      sy: h / (SPAN_TRACKS * 2.4),
      ...rgba(SPAN_COLORS[i % SPAN_COLORS.length]!, 0.6 + rnd() * 0.15),
    })
  }
  return instances
}

const SCATTER_CLUSTERS = [
  { cx: -0.4, cy: -0.32, spread: 0.22, color: ACCENT },
  { cx: 0.3, cy: 0.28, spread: 0.26, color: MINT },
  { cx: 0.62, cy: -0.3, spread: 0.16, color: AMBER },
] as const
const SCATTER_COUNT = 140

function scatterLayer(rnd: () => number): HeroInstance[] {
  const { halfW, halfH } = frustumHalfExtentsAt(DEPTH.scatter)
  const w = halfW * 0.6
  const h = halfH * 0.6
  const instances: HeroInstance[] = []
  for (let i = 0; i < SCATTER_COUNT; i++) {
    const cluster = SCATTER_CLUSTERS[i % SCATTER_CLUSTERS.length]!
    const u = Math.max(rnd(), 1e-9)
    const v = rnd()
    const r = Math.sqrt(-2 * Math.log(u)) * cluster.spread
    instances.push({
      tx: (cluster.cx + r * Math.cos(2 * Math.PI * v)) * w,
      ty: (cluster.cy + r * Math.sin(2 * Math.PI * v)) * h,
      tz: DEPTH.scatter,
      sx: w * 0.012,
      sy: w * 0.012,
      ...rgba(cluster.color, 0.72),
    })
  }
  return instances
}

export interface HeroScene {
  readonly instances: Float32Array<ArrayBuffer>
  readonly count: number
}

/** Packs every layer, in back-to-front order, into one storage-buffer-ready `Float32Array` — the
 * whole scene is one draw call's worth of instances (see `Hero3DComponent`). */
export function buildHeroScene(): HeroScene {
  const rnd = mulberry32(SEED)
  const layers = [
    backdropLayer(),
    heatmapLayer(rnd),
    gridRowsLayer(),
    timelineLayer(rnd),
    scatterLayer(rnd),
  ]
  const all = layers.flat()
  const floatsPerInstance = HERO3D_INSTANCE_STRIDE / 4
  // Explicit `new ArrayBuffer(...)` (not `new Float32Array(length)`), to get the concrete
  // `Float32Array<ArrayBuffer>` `StorageBuffer.write()` requires — TS 5.7's typed-array generics
  // otherwise widen a bare `Float32Array(length)` to `Float32Array<ArrayBufferLike>`, which allows
  // a `SharedArrayBuffer` backing and so isn't assignable to `BufferSource` (see commit
  // c69d7e2's fix for the same issue elsewhere in this codebase).
  const buffer = new Float32Array(new ArrayBuffer(all.length * floatsPerInstance * 4))
  all.forEach((inst, i) => {
    const o = i * floatsPerInstance
    buffer[o + 0] = inst.tx
    buffer[o + 1] = inst.ty
    buffer[o + 2] = inst.tz
    buffer[o + 3] = inst.sx
    buffer[o + 4] = inst.sy
    buffer[o + 5] = 0
    buffer[o + 6] = 0
    buffer[o + 7] = 0
    buffer[o + 8] = inst.r
    buffer[o + 9] = inst.g
    buffer[o + 10] = inst.b
    buffer[o + 11] = inst.a
  })
  return { instances: buffer, count: all.length }
}
